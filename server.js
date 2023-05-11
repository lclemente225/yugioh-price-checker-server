const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();

require('dotenv').config();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

//sql setup
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

const loginPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.LOGIN_DB_NAME
})
  

app.use(async function mysqlConnection(req, res, next) {
    try {
      req.db = await pool.getConnection();
      req.login = await loginPool.getConnection();

      req.db.connection.config.namedPlaceholders = true;
      req.login.connection.config.namedPlaceholders = true;
  
      // Traditional mode ensures not null is respected for unsupplied fields, ensures valid JavaScript dates, etc.
      await req.db.query('SET SESSION sql_mode = "TRADITIONAL"');
      await req.db.query(`SET time_zone = '-8:00'`);

      await req.login.query('SET SESSION sql_mode = "TRADITIONAL"');
      await req.login.query(`SET time_zone = '-8:00'`);
  
      await next();
      req.login.release();
      req.db.release();
    } catch (err) {
      // If anything downstream throw an error, we must release the connection allocated for the request
      console.log(err)
      if (req.db) req.db.release();
      throw err;
    }
  });
  
//authentication and authorization here 
//jwt key

app.post('/register', async (req, res) => {

  const checkEmail = await req.db.query(
    `SELECT email FROM yugioh_price_checker_login  
    WHERE email = :email`,
    { email: req.body.email });
    let hashedPassword = await bcrypt.hash(req.body.password, 8);

  try {
  if(checkEmail.length > 0){
    return console.log("email is already in use")
  }else{
    const registration = await req.login.query(
      `INSERT INTO yugioh_price_checker_login 
      (name, email, password)
      values(:username, :email, :password)`,
      {
        name: req.body.username,
        email: req.body.email,
        password: hashedPassword
      }
    )};

    
  }catch(err){
    console.log('post err card not added', err);
    res.status(500).json({ error: 'Failed to register' });
  }
});

//login here
//1. check username and password if it matches in sql table with info
//2. then that means it is authenticated 
//3. authorized to go to cart
//4. or possibly save cart?

app.get('/login', async (req, res) => {
  const hashPW = req.login.query(
    /*sql query here to look for pw which will be hashed
    SELECT password FROM yugioh_cart_login 
    WHERE name = :name 
    */), /*{name: req.body.username} */;
  const inputPassword = await bcrypt.hash(req.body.password, 8);
  const matchPassword = bcrypt.compare(inputPassword, hashedPW);

  if(matchPassword){
    console.log("login successful")
  }
  //set jwt key here
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
  try {
    // Check if card already exists in cart list
    const existingCard = await req.db.query(
      `SELECT quantity FROM yugioh_cart_list WHERE card_name = :card_name AND cartId = :cartId`,
      {
        card_name: req.body.card_name,
        cartId: req.body.cartId,
      }
    );

    if (existingCard[0][0] != undefined) {
      // If card already exists, update its quantity
      console.log("updated quantity", req.body.card_name, req.body.cartId);
      const updatedCartList = await req.db.query(
        `UPDATE yugioh_cart_list 
        SET quantity = quantity + 1, price = :price * quantity  
        WHERE card_name = :card_name AND cartId = :cartId`,
        {
          card_name: req.body.card_name,
          cartId: req.body.cartId,
          price: req.body.price
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
          cartId
        ) VALUES (
          :card_name,
          :price,
          :quantity,
          :cartId
        )`,
        {
          card_name: req.body.card_name,
          price: req.body.price,
          quantity: req.body.quantity,
          cartId: req.body.cartId,
        }
      );

      res.json(addCartList);
    }
  } catch (err) {
    console.log('post err card not added', err);
    res.status(500).json({ error: 'Failed to add card to cart' });
  }
});


//need to make a function that will update quantity
//this is performed in the function above
//possibly this will be needed for the cart?? 
//but maybe not since i might be able to reuse the above function

/* app.put('/cart/updateAddItem/:id', async(req, res) => {
  //if quantity is 0 then delete
  try{
  const productId = req.params.id;
 await req.db.query('UPDATE yugioh_cart_list SET quantity = quantity + 1 WHERE id = :id', {id: productId}, (error, result) => {
 
  });
}catch (err) { 
  console.log('put err did not add item', err)
}    
}) */

//COMPLETED
//function to subtract 1 and delete when quantity is 0 
app.put('/cart/updateSubtractItem', async(req, res, next) => {
  //if quantity is 0 then delete
  const selectedCard = await req.db.query(
    `SELECT id, quantity FROM yugioh_cart_list WHERE cartId = :cartId`,
    { cartId: req.body.cartId });
  
   try{
    console.log(selectedCard[0])
    if(selectedCard[0].length === 0){
      console.log("none here")
      return next();
    }
    if (selectedCard[0][0].quantity === 1) {
    
      await req.db.query(
        `DELETE FROM yugioh_cart_list 
        WHERE id = :id`,
        {id: selectedCard[0][0].id},
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
       WHERE id = :id`, 
    {id: selectedCard[0][0].id}, (error, result) => {
        console.log('ERROR IN SUBTRACTING 1 QUANTITY', error);
        console.log('SUCCESS IN SUBTRACTING 1 QUANTITY', result);
             })
    };
  
}catch (err) { 
  console.log('put err did not subtract item', err)
} 
    
})

app.delete('/cart/deleteItem/:id', async (req, res) => {
    //delete selected row
    //obtain id using name
    //get index of name and then get id from that 
    
    try {
        const addCartList = await req.db.query(
          `DELETE FROM yugioh_cart_list 
          WHERE id = :id`,
          {
            id: req.params.id
          }
        );
        
        res.json(addCartList)
      } catch (err) { 
        console.log('post /', err)
      }
})



//3. sql server will update and then when you go to the cart make a 
//get request or fetch the info

//the info will be in json
//map over the array of objects to render on the page

const port = process.env.PORT;
app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});