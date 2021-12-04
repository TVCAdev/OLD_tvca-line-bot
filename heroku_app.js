"use strict";

const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
const server = require("http").Server(app);

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
 set middlewares.
 this middleware drops packet which does not set the token.
 */
io.sockets.use((socket, next) => {
    let token = socket.handshake.query.token;
    if (token == process.env.WEBSOCKET_TOKEN) {
        return next();
    }
    //
    console.log("authentication error is occured.");
    return next(new Error("authentication error"));
});

/*
 set callback.
 this callback is called when connection of websocket is requested.
 */
io.sockets.on("connection", (socket) => {
    console.log("connected from" + socket.id);

    socket.on("SEND_MESSAGE_TO_LINE", (data) => {
        console.log(data);

        // parse JSON to Object
        let line_msg = JSON.parse(data);

        // create show message
        let show_msg = "以下のメッセージに対して" + line_msg.action + "が押されました。\n"
        show_msg += "ボタン押下時間: " + line_msg.action_date_str + "\n\n"
        show_msg += "> " + line_msg.text

        // push api message
        client.pushMessage(line_msg.senderID, {
            type: "text",
            text: show_msg,
        });
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
    // receive only text message or postback
    if (event.type !== "message" || event.type !== "postback") {
        return Promise.resolve(null);
    }

    // If websocket's connection is none, return error message
    if (Object.keys(io.sockets.connected).length == 0) {
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
        else {
            // get sender ID
            if (event.source.type == "user") {
                console.log("user " + event.source.userId);
                senderIDs = senderIDs.push(event.source.userId + "");
            } else if (event.source.type == "group") {
                console.log(
                    "group " + event.source.groupId + " " + event.source.userId
                );
                senderIDs = senderIDs.push(event.source.groupId + "");
            } else if (event.source.type == "room") {
                console.log(
                    "room " + event.source.roomId + " " + event.source.userId
                );
                senderIDs = senderIDs.push(event.source.roomId + "");
            }
        }
    }
}

// heroku assign process.env.PORT dynamiclly.
server.listen(process.env.PORT);
console.log(`Server running at ${process.env.PORT}`);
