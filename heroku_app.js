"use strict";

const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
const server = require("http").Server(app);
const io = require("socket.io")(server);

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
let senderIDs = [];

/*
 * Original Data of Image
 */
let origData;

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
        // convert picture data
        origData = Buffer.from(data.imgdata, 'base64');
        //fs.writeFileSync("/tmp/aaa.jpg", decode_file);

        // push api message
        senderIDs.forEach((senderID) => {
            client.pushMessage(senderID, {
                type: "image",
                originalContentUrl: process.env.BASEURL + process.env.ORIGFILENAME + ".img",
                previewImageUrl: process.env.BASEURL + process.env.PREVFILENAME + ".img",
            });

            let dName = ""

            // If process.env.ownerID is defined, send messages.
            if (typeof process.env.ownerID !== 'undefined' && process.env.ownerID != senderID) {

                // get user profile
                if (senderID != null) {
                    client.getProfile(senderID).then((profileData) => {
                        dName = profileData.displayName;
                    });
                }
            }
            // send message to notify
            client.pushMessage(senderID, {
                type: "text",
                text: "リビングの画像が" + dName + "(" + senderID + ")によって取得されました。",
            });
        });

        // delete all elements of senderIDs
        senderIDs.splice(0);
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
app.get("/" + process.env.ORIGFILENAME + ".img", (req, res) => {
    // send living pic data
    res.send(origData)
});

/*
 * function is called when image files requests.
 */
app.get("/" + process.env.PREVFILENAME + ".img", (req, res) => {
    // send living pic data
    res.send(origData)
});

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
                    ]
                }
            });
        }
        // type is postback
        else if (event.type == "postback") {
            // get sender ID
            if (event.source.type == "user") {
                console.log("user " + event.source.userId + "request living pic.");
                // if userID is not included in senderIDs, userID is added.
                if (!senderIDs.includes(event.source.userId)) {
                    senderIDs.push(event.source.userId + "");
                }

            } else if (event.source.type == "group") {
                console.log("group " + event.source.groupId + " " + event.source.userId + "request living pic.");
                // if groupId is not included in senderIDs, groupId is added.
                if (!senderIDs.includes(event.source.groupId)) {
                    senderIDs.push(event.source.groupId + "");
                }
            } else if (event.source.type == "room") {
                console.log("room " + event.source.roomId + " " + event.source.userId + "request living pic.");
                // if roomId is not included in senderIDs, roomId is added.
                if (!senderIDs.includes(event.source.roomId)) {
                    senderIDs.push(event.source.roomId + "");
                }
            }

            // send message to socket.io clients
            io.sockets.emit("GET_LIVINGPIC");
        }
        else {
            // receive only text message or postback
            return Promise.resolve(null);
        }
    }
}

// heroku assign process.env.PORT dynamiclly.
server.listen(process.env.PORT);
console.log(`Server running at ${process.env.PORT}`);
