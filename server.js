const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();
const { v4: uuidv4 } = require('uuid');//generate random id
const helmet = require('helmet');//for permissions policy config

require('dotenv').config();


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const allowedOrigins = [
                      'https://main--ygo-pricechecker.netlify.app', 
                      'http://localhost:5173', 
                      'https://ygo-pricechecker.netlify.app'
                    ];
const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
};

// Use the CORS middleware with the specified options
app.use(cors(corsOptions));

app.use(helmet());

const setPermissionsPolicy = (req, res, next) => {
  // Set the Permissions-Policy header to specify the features and origins you want
  res.setHeader(
    'Permissions-Policy'+
    'attribution-reporting = (https://main--ygo-pricechecker.netlify.app http://localhost:5173  https://ygo-pricechecker.netlify.app)'+
    'Cross-Origin-Embedder-Policy', 'require-corp'+
    'Cross-Origin-Opener-Policy', 'same-origin'+
    'run-ad-auction = (https://main--ygo-pricechecker.netlify.app http://localhost:5173  https://ygo-pricechecker.netlify.app)'+
    'join-ad-interest-group = (https://main--ygo-pricechecker.netlify.app http://localhost:5173  https://ygo-pricechecker.netlify.app)'+
    'browsing-topics = (https://main--ygo-pricechecker.netlify.app http://localhost:5173  https://ygo-pricechecker.netlify.app)'

    );
  next();
};

// Use the middleware to set the Permissions-Policy header
app.use(setPermissionsPolicy);



const salt = bcrypt.genSaltSync(6);
//sql setup
const pool = mysql.createPool({
    host: process.env.DATABASE_HOST_URL,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PW,
    database: process.env.DATABASE_USER
  });


app.use(async function mysqlConnection(req, res, next) {
    try {
      req.db = await pool.getConnection();

      req.db.connection.config.namedPlaceholders = true;
  
      // Traditional mode ensures not null is respected for unsupplied fields, ensures valid JavaScript dates, etc.
      await req.db.query('SET SESSION sql_mode = "TRADITIONAL"');
      await req.db.query(`SET time_zone = '-8:00'`);

  
      await next();
      req.db.release();
    } catch (err) {
      // If anything downstream throw an error, we must release the connection allocated for the request
      console.log(err)
      if (req.db) req.db.release();
      throw err;
    }
  });


app.post('/register', async (req, res) => {

    const checkEmail = await req.db.query(
      `SELECT email FROM yugioh_price_checker_users  
      WHERE email = :email`,
      { email: req.body.email });

    let userIdInfo = await req.db.query(
      `SELECT userId FROM yugioh_price_checker_users`
      )
      console.log(userIdInfo)
      

    let hashedPassword = await bcrypt.hash(req.body.password, salt);

    console.log(`REGISTERING 
    email:${req.body.email} 
    username:${req.body.username} 
    password:${req.body.password}
    hashed pass: ${hashedPassword}
    userID:${uuidv4()}`)

    try {
    if(checkEmail[0][0] != undefined){
      return console.error("email is already in use")
    }else if(checkEmail[0][0] != "" && req.body.password && req.body.username){
    

      const registration = await req.db.query(
        `INSERT INTO yugioh_price_checker_users
        (email, username, password, userId)
        VALUES( :email, :username, :password, :userId)`,
        {
          email: req.body.email,
          username: req.body.username,
          password: hashedPassword,
          userId: uuidv4()
        }
      )
        console.log("successfully registered new user")   
    }else{
      res.status(500).json({ error: 'Failed to register' });
      return console.error("please enter an email")
    };
      
    }catch(err){
      res.status(500).json({ error: 'Failed to register' });
    }
});


app.get('/checkUserId', async (req, res) => {
   try{
        const getUserId = await req.db.query(`
        SELECT userId, email FROM yugioh_price_checker_users`)
        
          return res.json(getUserId)
        
  }
  catch (error) {
        console.error('Error while querying userId:', error);
        return res.status(500).json({ error: 'Internal Server Error no check user id' });
  } 
})
 

function verifyJwt(req, res, next){

    const token = req.headers["access-token"];
    if(!token){
      return res.json({message: "we need token, please provide it next time"})
    } else {
          jwt.verify(token, "jwtSecretKey", (err, decoded) => {
            if(err){
              res.json({message: "not Authenticated"})
            }else{
              req.userId = decoded.id;
              next();
            }
          })
         }
}

app.get('/checkAuth', verifyJwt, (req,res) => {
    return res.json({message: "Authenticated"})
})

app.post('/login', async (req, res) => { 
  
  console.log("logging in")
  const userInfo = await req.db.query(
    `SELECT id, email, userId, password, username FROM yugioh_price_checker_users 
    WHERE username = :username `, 
    {username: req.body.username}
    );
    if(res.statusCode === null){
      return res.json({message:"you got the wrong user or pass buddy"})
    }
  const hashPW = userInfo[0][0].password; 
  const matchPassword = await bcrypt.compare(req.body.password, hashPW);
  
  if(matchPassword){ 
    console.log("Login Successful",res.statusCode) 
    //set jwt key here
    const email = userInfo[0][0].email;
    const id = userInfo[0][0].id;
    const userId = userInfo[0][0].userId;
    const token = jwt.sign({id}, "jwtsecretkey", {expiresIn: 300})
    
    return res.json({Login:true, "accessToken":token, "email":email, "userId":userId})
  }else{
    return res.status(401).json({message:"Wrong user or PASSWORD"})
  }
 

})

//update username endpoint
app.put('/profile-update-user', async(req,res) => {
  let insertedNewUsername = req.body.newUserName;

  let passwordCheck = await req.db.query(
    `SELECT password, username FROM yugioh_price_checker_users 
    WHERE email = :email `, 
    {email: req.body.email}
    );
  const hashPW = passwordCheck[0][0].password; 
  const matchPassword = await bcrypt.compare(req.body.password, hashPW);
  console.log(passwordCheck[0])
 
  if(passwordCheck[0][0].username === insertedNewUsername){
      return res.json("That username is already in use")
  }

  if(matchPassword){
    const selectedProfile = await req.db.query(
          `UPDATE yugioh_price_checker_users 
          SET email = :newEmail 
          WHERE email = :email`,
          {
            email: req.body.email,
            newEmail: insertedNewEmail
          }
        );

      console.log('email changed to ', req.body.newEmail)
         return res.json(selectedProfile)
    }else{
      return res.status(500).json({ 
                              error: 'Failed to change the email' 
                                  });
    }
})

//update email endpoint
app.put('/profile-update-email', async(req,res) => {
  let insertedNewEmail = req.body.newEmail;

  let infoCheck = await req.db.query(
    `SELECT email FROM yugioh_price_checker_users`);
  
  let isEmailInUse = false;

  infoCheck[0].map((emails) => {
    if(emails.email === insertedNewEmail){
      isEmailInUse = true;
    }
  })

  if(isEmailInUse){
    return res.json("Email already in use try another one")
  }else{

  let passwordCheck = await req.db.query(
    `SELECT password, email FROM yugioh_price_checker_users 
    WHERE email = :email`, 
    {email: req.body.email}
    );
  const hashPW = passwordCheck[0][0].password; 
  const matchPassword = await bcrypt.compare(req.body.password, hashPW);

  if(matchPassword){
    const selectedProfile = await req.db.query(
          `UPDATE yugioh_price_checker_users 
          SET email = :newEmail 
          WHERE email = :email`,
          {
            email: req.body.email,
            newEmail: insertedNewEmail
          } 
        );

      console.log('email changed to ', req.body.newEmail)
      //returning this variable will complete updating email
         return res.json(selectedProfile)
    }else{
      return res.status(500).json({ 
                              error: 'Failed to change the email' 
                                  });
    }
  }
})

//update password
//req.body.password
//req.body.newPassword
//if it is not the same as database then put retype password
//incomplete
//NEED email, pw and new pw
/*
1. check given pw with database pw
2. replace pw and hash it
3. that's it  
*/

/*app.put('/profile-update-pw', async(req,res) => {
  
  //email, pw, newpw
  

  let passwordCheck = await req.db.query(
    `SELECT password, email FROM yugioh_price_checker_users 
    WHERE email = :email `, 
    {email: req.body.email}
    );
  const newPW = req.body.newPassword;
  const hashPW = passwordCheck[0][0].password; 
  const matchPassword = await bcrypt.compare(req.body.password, hashPW);
  console.log(passwordCheck[0])
 

  if(matchPassword && req.body.password === newPW){
      return res.json("That is your current password")
  }

//if matchpw is true and email is true
//hash new pw and replace it in db
  if(matchPassword && passwordCheck[0][0].email === req.body.email){
    let hashedNewPassword = await bcrypt.hash(req.body.newPassword, salt);
    const selectedProfile = await req.db.query(
          `UPDATE yugioh_price_checker_users 
          SET password = ${hashedNewPassword} 
          WHERE email = :email`,
          {
            email: req.body.email
          }
        ); 

      console.log('PASSWORD CHANGED SUCCESS')
         return res.json(selectedProfile)
    }else{
      return res.status(500).json({ 
                              error: 'Failed to change the passworod' 
                                  });
    }
})*/

//delete info
//incomplete
app.delete('/profile-delete', async(req, res) => {
  const getId = await req.db.query(
        `SELECT id FROM yugioh_price_checker_users 
        WHERE email = :email`,
        {
          email: req.body.email
        });

  const id = getId[0][0].id;
  const hashPW = passwordCheck[0][0].password; 
  const matchPassword = await bcrypt.compare(req.body.password, hashPW);
  console.log(passwordCheck[0])
 
  if(passwordCheck[0][0].username === insertedNewUsername){
      return res.json("That username is already in use")
  }

  console.log(`deleting`)
   await req.db.query(
    `DELETE FROM yugioh_price_checker_users WHERE id = ${id}`)
})
 


//plan
//1. obtain info from react and yugioh api that is being used

app.get('/cart/list', async (req, res) => {
  //this is the data that comes from react when clicking on the + button
  try{
    const cartList = await req.db.query(`SELECT * FROM yugioh_cart_list`);
  
    return res.json(cartList);

  }catch(error){
    
    res.status(500).json({ error: 'Failed to find yoru cart' });
  }
}); 


//COMPLETED
//2. when you click a button, then it will send a post request to the sql server
//this function adds quantity if the card exists
app.put('/cart/add', async (req, res) => {
  
  const userIdFromClientSide = req.body.userId;
  console.log("USERID:", userIdFromClientSide)

  try {
    // Check if card already exists in cart list
    const existingCard = await req.db.query(
      `SELECT quantity FROM yugioh_cart_list 
      WHERE card_name = :card_name AND cartId = :cartId AND userId = :userId`,
      {
        card_name: req.body.card_name,
        cartId: req.body.cartId,
        userId: userIdFromClientSide
      }
    );
    console.log("TRYING TO ADD CARD TO CART", req.body.card_name, req.body.userId);

    if (existingCard[0][0] != undefined) {
      // If card already exists, update its quantity
      console.log("updated quantity", req.body.card_name, req.body.cartId);
      const updatedCartList = await req.db.query(
        `UPDATE yugioh_cart_list 
        SET quantity = quantity + 1, price = :price * quantity  
        WHERE card_name = :card_name AND cartId = :cartId AND userId = :userId`,
        {
          card_name: req.body.card_name,
          cartId: req.body.cartId,
          price: req.body.price,
          userId: userIdFromClientSide
        }
      );

      return res.json(updatedCartList);
    } else {
      console.log("added card to list", req.body.card_name)
      // If card doesn't exist, add it to cart list
      const addCartList = await req.db.query(
        `INSERT INTO yugioh_cart_list (
          card_name, 
          price,
          quantity,
          cartId,
          userId
        ) VALUES (
          :card_name,
          :price,
          :quantity,
          :cartId,
          :userId
        )`,
        {
          card_name: req.body.card_name,
          price: req.body.price,
          quantity: req.body.quantity,
          cartId: req.body.cartId,
          userId: userIdFromClientSide
        }
      );

      return res.json(addCartList);
    }
  } catch (err) {
    console.log('post err card not added', err);
    res.status(500).json({ error: 'Failed to add card to cart' });
  }
});



//COMPLETED
//function to subtract 1 and delete when quantity is 0 
app.put('/cart/updateSubtractItem', async(req, res) => {
  //if quantity is 0 then delete
  const userIdFromClientSide = req.body.userId;
  const selectedCard = await req.db.query(
    `SELECT id, quantity FROM yugioh_cart_list WHERE cartId = :cartId AND userId = :userId`,
    { 
      cartId: req.body.cartId,
      userId: userIdFromClientSide 
     });
  
   try{
    if(selectedCard[0].length === 0){
      console.log("none here")
      return next();
    }
    if (selectedCard[0][0].quantity === 1) {
    
      await req.db.query(
        `DELETE FROM yugioh_cart_list 
        WHERE id = :id AND userId = :userId`,
        {
          id: selectedCard[0][0].id,
          userId: userIdFromClientSide 
        });
    };

    if(selectedCard[0] != undefined){
        console.log("subtracting 1 quantity",selectedCard[0][0].quantity)  
        await req.db.query(
          `UPDATE yugioh_cart_list
          SET quantity = quantity - 1 
          WHERE id = :id AND userId = :userId`, 
          {
            id: selectedCard[0][0].id,
            userId: userIdFromClientSide 
          });
    };
    res.status(200).json({ message: 'Item updated successfully.' });
}catch (error) { 
  console.error('put err did not subtract item', error)
} 
    
})

app.delete('/cart/deleteItem', async (req, res) => {
  const userIdFromClientSide = req.body.userId;
  const cardName = req.body.card_name;
    //delete selected row
    //obtain id using name
    //get index of name and then get id from that 
    const existingCard = await req.db.query(
      `SELECT id FROM yugioh_cart_list
       WHERE card_name = :cardName AND cartId = :cartId AND userId = :userId`,
      {
        cardName: cardName,
        cartId: req.body.cartId,
        userId: userIdFromClientSide 
      }
    );

    if (existingCard[0].length === 0) {
      return res.status(404).json({ message: 'Item not found' });
    }

    console.log("deleting this one",existingCard[0])
    try {
     
        const deleteCartListItem = await req.db.query(
          `DELETE FROM yugioh_cart_list 
          WHERE id = :id AND userId = :userId`,
          {
            id: existingCard[0][0].id,
            userId: userIdFromClientSide 
          } 
        );
        
        res.json({ message: 'Item deleted successfully', deletedItem: cardName })
      } catch (err) {  
        console.log('did not delete', err)
        res.status(500).json({ message: 'Internal Server Error' }); 
      } 
})


const port = process.env.PORT;
app.listen(port, () => {
    console.log(`Server started on port ${port}`);
}); 