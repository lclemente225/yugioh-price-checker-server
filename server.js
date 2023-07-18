const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();
const { v4: uuidv4 } = require('uuid');//generate random id

require('dotenv').config();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

const salt = bcrypt.genSaltSync(6);
//sql setup
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
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
  }else{
  

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
        return res.status(500).json({ error: 'Internal Server Error' });
  } 
})
 

function verifyJwt(req, res, next){
    const token = req.headers["access-token"];
    if(!token){
      return res.json("we need token, please provide it next time")
    } else {
          jwt.verify(token, "jwtSecretKey", (err, decoded) => {
            if(err){
              res.json("not Authenticated")
            }else{
              req.userId = decoded.id;
              next();
            }
          })
         }
}

app.get('/checkAuth', verifyJwt, (req,res) => {
    return res.json("Authenticated")
})

app.post('/login', async (req, res) => {
  const userInfo = await req.db.query(
    `SELECT id, email, userId, password FROM yugioh_price_checker_users 
    WHERE username = :username `, 
    {username: req.body.username}
    );
  const hashPW = userInfo[0][0].password; 
  const matchPassword = await bcrypt.compare(req.body.password, hashPW); 

  if(matchPassword){ 
    //set jwt key here
    const email = userInfo[0][0].email;
    const id = userInfo[0][0].id;
    const userId = userInfo[0][0].userId;
    const token = jwt.sign({id}, "jwtsecretkey", {expiresIn: 300})
    console.log("login successful")
    return res.json({Login:true, "accessToken":token, "email":email, "userId":userId})
  }else{
    console.log("incorrect password")
  }
 

})
 


//plan
//1. obtain info from react and yugioh api that is being used

app.get('/cart/list', async (req, res) => {
  //this is the data that comes from react when clicking on the + button
  const cartList = await req.db.query(`SELECT * FROM yugioh_cart_list`);
  res.json(cartList);
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

      res.json(updatedCartList);
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

      res.json(addCartList);
    }
  } catch (err) {
    console.log('post err card not added', err);
    res.status(500).json({ error: 'Failed to add card to cart' });
  }
});



//COMPLETED
//function to subtract 1 and delete when quantity is 0 
app.put('/cart/updateSubtractItem', async(req, res, next) => {
  //if quantity is 0 then delete
  const userIdFromClientSide = req.body.userId;
  const selectedCard = await req.db.query(
    `SELECT id, quantity FROM yugioh_cart_list WHERE cartId = :cartId AND userId = :userId`,
    { 
      cartId: req.body.cartId,
      userId: userIdFromClientSide 
     });
  
   try{
    console.log(selectedCard[0])
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
        },
        (error, result) => {
          console.log('ERRaaOR DELETING IN PUT REQ', error);
          console.log('SUCCESSFULLY DELETED IN PUT REQ', result);
        }
      );
    }

    if(selectedCard[0] != undefined){
    console.log("subtracting 1 quantity",selectedCard[0][0].quantity)  
    await req.db.query(
      `UPDATE yugioh_cart_list
       SET quantity = quantity - 1 
       WHERE id = :id AND userId = :userId`, 
    {
      id: selectedCard[0][0].id,
      userId: userIdFromClientSide 
    }, (error, result) => {
        console.log('ERROR IN SUBTRACTING 1 QUANTITY', error);
        console.log('SUCCESS IN SUBTRACTING 1 QUANTITY', result);
             })
    };
  
}catch (err) { 
  console.log('put err did not subtract item', err)
} 
    
})

app.delete('/cart/deleteItem', async (req, res) => {
  const userIdFromClientSide = req.body.userId;
    //delete selected row
    //obtain id using name
    //get index of name and then get id from that 
    const existingCard = await req.db.query(
      `SELECT id FROM yugioh_cart_list
       WHERE card_name = :card_name AND cartId = :cartId AND userId = :userId`,
      {
        card_name: req.body.card_name,
        cartId: req.body.cartId,
        userId: userIdFromClientSide 
      }
    );
    console.log("deleting this one",existingCard[0])
    try {
     
        const addCartList = await req.db.query(
          `DELETE FROM yugioh_cart_list 
          WHERE id = :id AND userId = :userId`,
          {
            id: existingCard[0][0].id,
            userId: userIdFromClientSide 
          }
        );
        
        res.json(addCartList)
      } catch (err) { 
        console.log('did not delete', err)
      }
})


const port = process.env.PORT;
app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});