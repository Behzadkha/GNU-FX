const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const { stderr } = require('process');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const utils = require('./utils');
const uploadImage = require('./routes/uploadImage');
const imageValidationRoutes = require('./routes/ImageValidation');
const diagnoseRouter = require('./routes/diagnose');
const userRoutes = require('./routes/user');
const forgotpasswordRoutes = require('./routes/ForgotPassword');
const { StatusCode } = require('status-code-enum')

app.use(cors());
app.use(fileUpload());
app.use(express.static('./images'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const mongoose = require('mongoose');


/*
    database schemas
*/
const userSchema = require("./database/userSchema");
const toe_dataSchema = require("./database/toe-dataSchema");
const verificationLinks = require('./database/verificationLinks');

//database Connection
(async () => {
    try {
        await mongoose.connect(config.database, { useNewUrlParser: true, useUnifiedTopology: true });
    } catch (e) {
        throw e;
    }
})();

/*
    Creates a folder in folder /images.
    The folder will be user for storing the images.
    Param userId: the folder's name referring the the folder owner.
*/
function createImageFolder(userId) {
    return new Promise((resolve, reject) => {
        utils.runCommand(`cd images && mkdir ${userId}`).then(() => {
            resolve();
        })
    })
}

/*
    Creates a new user in the database.
    It hashes the given password and only stores the hashed value.
    Param name: the name given by the user in the signup form.
    Param email: the email address given by the user.
    Param password: the password in text given by the user.
    Param birthday: user's birthday.
*/
function createNewUser(name, email, password, birthday) {
    return new Promise((resolve, reject) => {
        //hash rounds
        const rounds = 10;
        //hash the password
        bcrypt.genSalt(rounds, (err, salt) => {
            bcrypt.hash(password, salt, (err, hash) => {
                if (err) throw err;
                //creating a new user with the hashed password
                const newUser = new userSchema({ email: email, name: name, password: hash, images: [], birthday: birthday });
                newUser.save().then(() => {
                    console.log("new user added to db");
                    resolve(newUser);

                }).catch(err => console.log(err));
            });
        });
    });
}

/*
    Creates a new object in the toe-data (database) for a new user.
*/
function createEmptyToeEntery(userId) {
    const emptyFeet = utils.emptyFeet;
    const newToeData = new toe_dataSchema({
        userID: userId,
        feet: emptyFeet
    });

    return new Promise((resolve, reject) => {
        newToeData.save().then(() => {
            resolve();
        });
    });
}

/*
    creates a signed jwt token.
    Sent to the user on login
    returns a promise with the token if resolved.
*/
function createSignedToken(payload, key, expiresIn) {
    return new Promise((resolve, reject) => {
        jwt.sign(payload, key, { expiresIn: expiresIn },
            (err, token) => {
                resolve(token);
            })
    });
};


/*
    Login endpoint.
    Finds the user in the database and returns as the response a jwt token representing the user.
    Body Param email: user's email address.
    Body Param password: user's password in text.  
*/
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (email === "" || password === "")
        return res.status(StatusCode.ClientErrorBadRequest)
            .json({ errorMsg: "BLANK_FIELD" });

    //searching for the provided email in the database
    try {
        userSchema.findOne({ email: email }).then(user => {
            if (user) {
                bcrypt.compare(password, user.password).then(async (valid) => {
                    if (valid) {
                        if (user.emailverified) {
                            const payload = {
                                id: user.id,
                                name: user.name
                            };

                            var token = await createSignedToken(payload, config.secretKey, "1 day");
                            res.status(StatusCode.SuccessAccepted).json({
                                success: true,
                                token: "Bearer " + token
                            });
                        }
                        else {
                            sendVerificationEmail(user.name, email); //Send verification email again
                            return res.status(StatusCode.ClientErrorLocked)
                                .json({ errorMsg: "UNVERIFIED_ACCOUNT" });
                        }
                    }
                    else {
                        return res.status(StatusCode.ClientErrorUnauthorized)
                            .json({ errorMsg: "INVALID_CREDENTIALS" });
                    }
                });
            }
            else { //The email address is not found
                res.status(StatusCode.ClientErrorNotFound)
                    .json({ errorMsg: "INVALID_EMAIL" });
            }
        });
    }
    catch {
        console.log("Login failed");
        res.status(StatusCode.ClientErrorBadRequest)
            .json({ errorMsg: "UNKNOWN_ERROR" });
    }
});

/*
    If any of the required inputs are empty or undefined, returns an error message
*/
function checkInput(name, email, password, birthday) {
    // if required input is empty
    if (name === "" || email === "" || password === "" || birthday === "") {
        return ("Required input is empty");
    }
    //if required input is undefined
    else if (name === undefined || email === undefined || password === undefined || birthday === undefined) {
        return ("Required input is undefined");
    }
    else {
        return ("NOERROR");
    }
}

function validateEmail(email) {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
}

function isValidName(name) {
    const re = /^[a-zA-Z]{3,} [a-zA-Z]+$/;
    return re.test(name);
}

function isValidPassword(password) {
    return password.match(/[a-z]+/) && password.match(/[A-Z]+/) &&
    password.match(/[0-9]+/) &&
    password.length >= 8;
}

function hashedURL(email) {
    return new Promise((Resolve, Reject) => {
        const rounds = 10
        bcrypt.genSalt(rounds, (err, salt) => {
            bcrypt.hash(email, salt, (err, hash) => {
                // e.g url: http://localhost:3000/emailverification/hashedemailaddress
                Resolve(`${config.dev_client}/emailverification/${hash}`)
            });
        });
    });

}

async function sendVerificationEmail(name, email) {
    const urlTobeSent = await hashedURL(email);
    const subject = "Email Verification";
    const body = `${name},\n\nPlease click on the link below to verify your email address. If you have not created an account, simply ignore this email.\n\n${urlTobeSent}\n\nThank you,\n\nToeFX Team`;

    //Add the url to the database(verificationLink schema)
    var verification = new verificationLinks({ email: email, link: urlTobeSent })
    verification.save();

    //send email
    utils.sendEmail(email, subject, body);
}

/*
    signup endpoint.
    Creates a new user and an image folder for the new user. 
    returns a 200 response if successful, 400 otherwise
    Param name: the name given by the user in the signup form.
    Param email: the email address given by the user.
    Param password: the password in text given by the user.
    Param birthday: user's birthday.
*/
app.post('/signup', (req, res) => {
    const { name, email, password, birthday } = req.body;
    const inputValidMsg = checkInput(name, email, password, birthday);

    if (inputValidMsg !== "NOERROR") {
        return res.status(StatusCode.ClientErrorBadRequest).json({ msg: inputValidMsg });
    }
    if (!validateEmail(email)) {
        return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "invalid email address" });
    }

    if (!isValidPassword(password)) {
        return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "invalid password" });
    }
    if (!isValidName(name)) {
        return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "wrong name format" });
    }

    
    
    try {
        userSchema.findOne({ email: email }).then(async (user) => {
            //the email address already exists
            if (user) {
                return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "Account already exists" });
            }
            else {
                try {
                    //creating a new user
                    const user = await createNewUser(name, email, password, birthday);
                    //creating a new image folder for the user
                    createImageFolder(user.id).then(() => {
                        createEmptyToeEntery(user.id).then(() => {
                            res.status(StatusCode.SuccessOK).json({});
                        });
                    })

                    sendVerificationEmail(name, email);
                }
                catch {
                    res.status(StatusCode.ClientErrorBadRequest).json();
                }
            }
        });
    }
    catch {
        console.log("not able to finish the signup process");
    }
});

app.post('/emailverification', async (req, res) => {
    const url = req.body.url
    // IMPORTANT: It finds the link and deletes it if it was successful.
    verificationLinks.findOneAndDelete({ link: url }).then((VLINK) => {
        if(VLINK) {
            userSchema.findOne({ email: VLINK.email }).then(async (user) => {
                if (user) {
                    user.emailverified = true
                    user.save()

                    return res.json({errorMsg: ""}) //It was successful
                }
                else {
                    return res.json({errorMsg: "The email address does not exist in the database."})
                }
            })
        }
        else {
            return res.json({errorMsg: "The account verification link is invalid or has already been used."})
        }
    })
});

/*
    Recieves an image name as the query parameter and checks if the image belongs to the user
    if it is valid, it sends back the file as the response.
    Query Param imageName: the name of the image to be sent.
*/
app.get('/getImage', async (req, res) => {
    try {
        //validating the user token
        var userObject = await utils.loadUserObject(req, res);
        var user = userObject.user;
        var userId = userObject.id;
        let imageName = req.query.imageName;
        if (imageName === undefined) { return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "ImageName should be specified" }) }
        //if the specified images is actually owned by the the user
        if (await user.images.includes(imageName))
            res.sendFile(`${__dirname}/images/${userId}/${imageName}`);
        else
            res.status(StatusCode.ClientErrorBadRequest).json({ msg: "Invalid request" });
    }
    catch (e) {
        //console.log(e)
        res.status(StatusCode.ClientErrorBadRequest).json({ msg: "Invalid token , tried to get an image" });
    }
});

/*
    deletes an image from the database and from the server storage
    requires 4 query string params
    footIndex: the index of the foot to be deleted, 0: left foot, 1: right foot
    toeIndex: the index of the toe to be deleted
    imageIndex: the index of the image to be deleted. we might have multiple images for a toe.
    imageName: the name of the image to be deleted. 
*/
app.get('/deleteImage', async (req, res) => {
    try {
        var userObject = await utils.loadUserObject(req, res);
        var user = userObject.user;
        var userId = userObject.id;

        if (req.query.footIndex === undefined || req.query.toeIndex === undefined || req.query.imageIndex === undefined || req.query.imageName === undefined) {
            return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "4 query params are undefined" });
        }

        const footIndex = req.query.footIndex;
        const toeIndex = req.query.toeIndex;
        const imageIndex = req.query.imageIndex;
        const imageName = req.query.imageName;

        //Delete the toe from toe data collection
        const toeData = await utils.getToeData(userId);
        if (toeData) {
            try {
                toeData.feet[footIndex].toes[toeIndex].images.splice(imageIndex, 1);
            } catch {
                return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "specified toe or foot does not exist" });
            }
        }
        else {
            return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "not found" });
        }

        //deleting the toe image from the user collection
        user.images.splice(user.images.findIndex(name => name == imageName), 1);

        //deleting the toe image from the user images folder
        let command = `rm images/${userId}/${imageName}`
        if (config.hostType.includes("Windows"))
            command = `del images\\${userId}\\${imageName}`
        utils.runCommand(command);

        //saving the new data in the database
        toeData.save();
        user.save();

        return res.status(StatusCode.SuccessOK).json({ msg: "Image deleted successfully" });
    }
    catch {
        return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "Something happened when tried to delete an image (might be an invalid token)" })
    }
});

/*
    Find the user's toe data from the DB.
    Returns as the response: the toe data.
*/
app.get('/getToe', async (req, res) => {

    try {
        var userObject = await utils.loadUserObject(req, res);
        var userId = userObject.id;

        //find the user's data from the database(take a look at database/toe-dataSchema.js)
        toe_dataSchema.findOne({ userID: userId }).then(data => {
            if (data) {
                return res.json(data);
            } else {
                return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "Data not found" });
            }
        });
    }
    catch (e) {
        return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "Invalid user token" })
    }
});

/*
    returns as the response: the list user's images
*/
app.get('/getImageNames', async (req, res) => {
    try {
        var userObject = await utils.loadUserObject(req, res);
        var user = userObject.user;
        return res.send(user.images)
    }
    catch {
        return res.status(StatusCode.ClientErrorBadRequest).json({ msg: "Something happened when tried to get user's image names" });
    }
});

/*
    other Routes
*/
app.use('/upload', uploadImage);
app.use('/imageValidation', imageValidationRoutes);
app.use('/diagnose', diagnoseRouter);
app.use('/user', userRoutes);
app.use('/forgotpassword', forgotpasswordRoutes);

module.exports = app;