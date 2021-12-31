"use strict";

const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
const server = require("http").Server(app);

// for debug code
// const fs = require('fs');
// const server = require('https').createServer({
//     key: fs.readFileSync('./privatekey.pem'),
//     cert: fs.readFileSync('./cert.pem'),
// }, app)

const io = require("socket.io")(server);
const PORT = process.env.PORT || 3000;

/**
 * LINE CHANNEL SECRET
 */
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

/**
 * LINE CHANNEL ACCESS TOKEN
 */
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const config = {
    channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: LINE_CHANNEL_SECRET,
};

/*
 * LINE BOT client
 */
const client = new line.Client(config);

/*
 * List of requested userID
 */
let getpicIDs = [];
let getlocIDs = [];

/*
 * Original Data of Image
 */
let origData;

/*
 send notification message to owner user.
 */
function sendOwner(senderID, target) {
    // If process.env.OWNERID is defined, send messages.
    if (typeof process.env.OWNERID !== 'undefined' && process.env.OWNERID != senderID) {
        let dName = ""
        // get user profile
        if (senderID != null) {
            client.getProfile(senderID).then((profileData) => {
                dName = profileData.displayName;
            });
        }

        // send message to notify
        client.pushMessage(process.env.OWNERID, {
            type: "text",
            text: target + "が" + dName + "(" + senderID + ")によって取得されました。",
        });
    }
}

/*
 set middlewares.
 this middleware drops packet which does not set the token.
 */
io.sockets.use((socket, next) => {
    let token = socket.handshake.query.token;
    if (token == process.env.WEBSOCKET_TOKEN) {
        return next();
    }
    // do not match token
    console.log("authentication error is occured.");
    return next(new Error("authentication error"));
});

/*
 set callback.
 this callback is called when connection of websocket is requested.
 */
io.sockets.on("connection", (socket) => {
    console.log("connected from" + socket.id);

    socket.on("GET_LIVINGPIC", (data) => {
        console.log("reply of GET_LIVINGPIC was received")
        // convert picture data
        origData = Buffer.from(data.imgdata, 'base64');
        //fs.writeFileSync("/tmp/aaa.jpg", decode_file);

        // push api message
        getpicIDs.forEach((senderID) => {
            client.pushMessage(senderID, {
                type: "image",
                originalContentUrl: process.env.BASEURL + process.env.ORIGFILENAME + ".jpg",
                previewImageUrl: process.env.BASEURL + process.env.PREVFILENAME + ".jpg",
            });

            // send message to owner 
            sendOwner(senderID, "リビングの画像");
        });
        // delete all elements of getpicIDs
        getpicIDs.splice(0);
    });

    socket.on("POST_LOCATION", (data) => {
        console.log(`reply of GET_LOCATION was received. latitude:${data.latitude} longitude:${data.longitude}`)

        // push api message
        getlocIDs.forEach((senderID) => {
            client.pushMessage(senderID, {
                type: "location",
                title: "パパの現在地",
                address: "パパの現在地",
                latitude: data.latitude,
                longitude: data.longitude,
            });

            // send message to owner 
            sendOwner(senderID, "パパの現在地");
        });
        // delete all elements of getpicIDs
        getlocIDs.splice(0);
    });
});

/*
 set callback.
 this callback is called when disconnection of websocket is requested.
 */
io.sockets.on("disconnection", (socket) => {
    console.log("disconnected");
});

/*
 * function is called when image files requests.
 */
app.get("/" + process.env.ORIGFILENAME + ".jpg", (req, res) => {
    // send living pic data
    res.send(origData)
});

/*
 * function is called when image files requests.
 */
app.get("/" + process.env.PREVFILENAME + ".jpg", (req, res) => {
    // send living pic data
    res.send(origData)
});

/*
 * function is called when line message is received from LINE.
 */
app.get("/" + process.env.LOCATIONNAME, (req, res) => {
    console.log(process.env.LOCATIONNAME + " was opend.");

    // HTML code for position get
    let html_contents =
        `<!DOCTYPE html>
<html>
    <head><meta charset="UTF-8" /><title>Get</title>
        <script src="/socket.io/socket.io.js"></script>
        <script type="text/javascript">
            // success function
            function pos_handler(position) {
                console.log("pos_handler start...");

                // send latitude, longitude to heroku
                socket.emit("POST_LOCATION", { latitude: position.coords.latitude, longitude: position.coords.longitude });
            }

            // error function
            function error_handler(err) {
                console.log("ERROR(" + err.code + "): " + err.message);

                socket.emit("POST_LOCATION", { latitude: 0.0, longitude: 0.0 });
            }

            // connect server
            const socket = io({
                query: {
                    token: "${process.env.WEBSOCKET_TOKEN}"
                },
            });

            socket.on("GET_LOCATION", () => {
                console.log("GET_LOCATION Received...");
                navigator.geolocation.getCurrentPosition(pos_handler, error_handler, { enableHighAccuracy: true });
            });
        </script>
    </head>

    <body>
        Do not close this page because of running script for getting location.
    </body>
</html>`

    // return HTML
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write(html_contents);
    res.end();
});

// for debug code
// setInterval(() => io.emit("GET_LOCATION"), 10000);

/*
 * function is called when line message is received from LINE.
 */
app.post("/callback", line.middleware(config), (req, res) => {
    console.log(req.body.events);
    Promise.all(req.body.events.map(handleEvent)).then((result) =>
        res.json(result)
    );
});

/**
 * handler called when line message is received.
 */
function handleEvent(event) {

    // If websocket's connection is none, return error message
    if (io.engine.clientsCount == 0) {
        return client.replyMessage(event.replyToken, {
            type: "text",
            text: "Websocketが接続されていません。",
        });
    } else {
        // type is message
        if (event.type == "message") {
            // return button template
            return client.replyMessage(event.replyToken, {
                type: "template",
                altText: "This is a buttons template",
                template: {
                    type: "buttons",
                    title: "お願いしたいこと",
                    text: "アクションを選択してください。",
                    actions: [
                        {
                            "type": "postback",
                            "label": "リビングの現在画像",
                            "data": "action=getpic"
                        },
                        {
                            "type": "postback",
                            "label": "パパの現在地",
                            "data": "action=getloc"
                        },]
                }
            });
        }
        // type is postback
        else if (event.type == "postback") {

            // function for setting sender IDs
            function set_senderIDs(setIDs) {
                // get sender ID
                if (event.source.type == "user") {
                    console.log("user " + event.source.userId);
                    // if userID is not included in setIDs, userID is added.
                    if (!setIDs.includes(event.source.userId)) {
                        setIDs.push(event.source.userId + "");
                    }

                } else if (event.source.type == "group") {
                    console.log("group " + event.source.groupId + " " + event.source.userId);
                    // if groupId is not included in setIDs, groupId is added.
                    if (!setIDs.includes(event.source.groupId)) {
                        setIDs.push(event.source.groupId + "");
                    }
                } else if (event.source.type == "room") {
                    console.log("room " + event.source.roomId + " " + event.source.userId);
                    // if roomId is not included in setIDs, roomId is added.
                    if (!setIDs.includes(event.source.roomId)) {
                        setIDs.push(event.source.roomId + "");
                    }
                }
            }

            if (event.postback.data == "action=getpic") {
                set_senderIDs(getpicIDs)
                // send GET_LIVINGPIC message to socket.io clients
                console.log("GET_LIVINGPIC was fired.");

                // send GET_LIVINGPIC message to socket.io clients(target is raspberry pi.)
                io.sockets.emit("GET_LIVINGPIC");
            }
            else if (event.postback.data == "action=getloc") {
                set_senderIDs(getlocIDs)
                console.log("GET_LIVINGPIC was fired.");

                // send GET_LOCATION message to socket.io clients(target is father's smartphone.)
                io.sockets.emit("GET_LOCATION");
            }

        }
        else {
            // receive only text message or postback
            return Promise.resolve(null);
        }
    }
}

// heroku assign process.env.PORT dynamiclly.
server.listen(PORT);
console.log(`Server running at ${PORT}`);
