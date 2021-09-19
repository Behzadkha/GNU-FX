/*
    Various configuration details for the server.
*/

var os = require("os");

const config = {
    secretKey: "secretKey",
    database: `mongodb+srv://behdad:FXDev2021:D@user.nurmz.mongodb.net/user?retryWrites=true&w=majority`,
    hostType: os.type(),
    dev_client : "http://localhost:3000",
    dev_email: "email",
    dev_epass: "password"
}

module.exports = config;
