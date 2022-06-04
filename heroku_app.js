"use strict";

const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
const server = require("http").Server(app);

const firebaseadmin = require('firebase-admin');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// for debug code
// const fs = require('fs');
// const server = require('https').createServer({
//     key: fs.readFileSync('./privatekey.pem'),
//     cert: fs.readFileSync('./cert.pem'),
// }, app)

const io = require("socket.io")(server);
const PORT = process.env.PORT || 3000;

/**
 * FUNCTION FOR CHECKING URL TOKEN AUTHENTICATION
 */

const check_url_token = function (req, res, next) {
    if ((req.query.url_token !== undefined) && (req.query.url_token == process.env.URL_TOKEN)) {
        next()
    }
    else {
        res.status(401).end()
    }
}

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
let getTVStsIDs = [];

/*
 * Original Data of Image
 */
let origData;

/*
 * Initialize Firebase
 */
initializeApp({
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
});

const db = getFirestore();

/*
 send line message to owner user.
 */
function sendOwner(senderID, target) {
    // If process.env.OWNERID is defined, send messages.
    if (typeof process.env.OWNERID !== undefined && process.env.OWNERID != senderID) {
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

function sendOwnerText(text) {
    // If process.env.OWNERID is defined, send messages.
    if (typeof process.env.OWNERID !== undefined) {
        // send message to notify
        client.pushMessage(process.env.OWNERID, {
            type: "text",
            text: text
        });
    }
}

/*
 send notification message for getting location.
 */
function sendNotification() {
    // get token from location document.
    const locRef = db.collection('config').doc('location');
    locRef.get()
        .then(doc => {
            if (!doc.exists) {
                console.log('document location was not exist.');
            } else {
                const dbdata = doc.data()
                console.log('Document data:', dbdata);

                // get registration token
                if ("token" in dbdata) {
                    const message = {
                        data: {
                            action: 'GET_LOCATION'
                        },
                        token: dbdata.token
                    };

                    // Send a message to the device corresponding to the provided
                    // registration token.
                    firebaseadmin.messaging().send(message)
                        .then((response) => {
                            // Response is a message ID string.
                            console.log('Successfully sent message:', response);
                        })
                        .catch((error) => {
                            console.log('Error sending message:', error);
                        });
                } else {
                    console.log('token was not registerd');
                }
            }
        })
        .catch((error) => {
            console.log('getting document location was error.:', error);
        });
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
                originalContentUrl: process.env.BASEURL + process.env.ORIGFILENAME + ".jpg?url_token=" + process.env.URL_TOKEN,
                previewImageUrl: process.env.BASEURL + process.env.PREVFILENAME + ".jpg?url_token=" + process.env.URL_TOKEN,
            });

            // send message to owner 
            sendOwner(senderID, "リビングの画像");
        });
        // delete all elements of getpicIDs
        getpicIDs.splice(0);
    });

    socket.on("GET_TV_STATUS", (data) => {
        console.log("reply of GET_TV_STATUS was received")

        let text_string = "現在のステータス";
        let data_size = data.length;
        let actions = Array(data_size * 2);

        // read setting of TV bans.
        const locRef = db.collection('config').doc('TVbans');

        locRef.get()
            .then(doc => {
                if (!doc.exists) {
                    console.log('document TVbans was not exist.');
                } else {
                    const dbdata = doc.data()
                    console.log('Document data:', dbdata);

                    // make TVs status information
                    data.forEach((TV, index) => {
                        actions[index] = new Object();
                        actions[index].type = "postback";

                        // get registration information for TVbans
                        if (data[index].name in dbdata) {
                            if (dbdata[data[index].name] == "0") {
                                text_string += "\n" + data[index].name + "は許可状態: " + data[index].status;
                                actions[index].label = data[index].name + "を禁止状態にする。";
                                actions[index].data = "action=banTVs&changeTo=1&name=" + data[index].name;
                            }
                            else if (dbdata[data[index].name] == "1") {
                                text_string += "\n" + data[index].name + "は禁止状態: " + data[index].status;
                                actions[index].label = data[index].name + "を許可状態にする。";
                                actions[index].data = "action=banTVs&changeTo=0&name=" + data[index].name;
                            }
                            else {
                                console.log(data[index].name + ' registration was abnormal.');
                                return;
                            }
                        }
                        else {
                            console.log(data[index].name + ' was not registerd in TVbans doc.');
                            return;
                        }

                        // add log view postback
                        actions[data_size + index] = new Object();
                        actions[data_size + index].type = "postback";
                        actions[data_size + index].label = data[index].name + "のログを表示する。";
                        actions[data_size + index].data = "action=showBanTVLogs&name=" + data[index].name;
                    });

                    // push api message
                    getTVStsIDs.forEach((senderID) => {
                        client.pushMessage(senderID, {
                            type: "template",
                            altText: "This is a buttons template",
                            template: {
                                type: "buttons",
                                title: "TV禁止",
                                text: text_string,
                                actions: actions
                            }
                        });

                        // send message to owner 
                        sendOwner(getTVStsIDs, "TVステータス");
                    });
                    // delete all elements of getpicIDs
                    getTVStsIDs.splice(0);
                }
            })
            .catch((error) => {
                console.log('getting document TVbans was error.:', error);
            });
    });

    socket.on("GET_TVBAN", param => {
        console.log("GET_TVBAN was received")

        // read setting of TV bans.
        const TVbansRef = db.collection('config').doc('TVbans');

        TVbansRef.get()
            .then(doc => {
                if (!doc.exists) {
                    console.log('document TVbans was not exist.');
                } else {
                    const dbdata = doc.data()
                    console.log('Document data:', dbdata);

                    // get registration information for TVbans
                    if (param.name in dbdata) {
                        // send GET_TVBAN message to TVCA router.
                        io.sockets.emit("GET_TVBAN", { 'name': param.name, 'ban': dbdata[param.name] });
                    }
                }
            })
            .catch((error) => {
                console.log('getting document TVbans was error.:', error);
            });
    });


    socket.on("LOG_TV_STATUS", param => {
        console.log("LOG_TV_STATUS was received")

        const LogsRef = db.collection('log').doc('TVStatus').collection('Logs');

        LogsRef.add({
            name: param.name,
            status: param.status,
            date: firebaseadmin.firestore.FieldValue.serverTimestamp()
        })
            .catch((error) => {
                console.log('adding log was error.:', error);
            });
    });

    socket.on("NOTIFY_TV_OFFLINE", param => {
        console.log("NOTIFY_TV_OFFLINE was received")

        // send offline message to 
        sendOwnerText(param.name + ' status was change to offline.');
    });
});

/*
 set callback.
 this callback is called when disconnection of websocket is requested.
 */
io.sockets.on("disconnection", (socket) => {
    console.log("disconnected");

    // send offline message to 
    sendOwnerText('TVCARouter was disconnected.');
});

/*
 * function is called when image files requests.
 */
app.get("/" + process.env.ORIGFILENAME + ".jpg", check_url_token, (req, res) => {
    // send living pic data
    res.send(origData)
});

/*
 * function is called when image files requests.
 */
app.get("/" + process.env.PREVFILENAME + ".jpg", check_url_token, (req, res) => {
    // send living pic data
    res.send(origData)
});

/*
 * function is called when father's smartphone sended location information.
 */
app.post("/" + process.env.LOCATION_URL, check_url_token, express.json(), (req, res) => {
    console.log("LOCATION_URL called...");

    // case of register token
    if (('token' in req.body) && req.body.token != null) {
        // register token to firebase cloud firestore
        const locRef = db.collection('config').doc('location');

        locRef.set({ token: req.body.token })
            .then(ref => {
                console.log("registering token was succeed.");
            })
            .catch(error => {
                console.log("registering token was failed...:", error);
            });
    }
    // case of response getting location
    else if (('latitude' in req.body) && ('longitude' in req.body)
        && req.body.latitude != null && req.body.longitude != null) {
        console.log("reply of GET_LOCATION was received. latitude:" + req.body.latitude + " longitude: " + req.body.longitude + ".");

        // push api message
        getlocIDs.forEach((senderID) => {
            client.pushMessage(senderID, {
                type: "location",
                title: "パパの現在地",
                address: "パパの現在地",
                latitude: req.body.latitude,
                longitude: req.body.longitude,
            });

            // send message to owner 
            sendOwner(senderID, "パパの現在地");
        });
        // delete all elements of getpicIDs
        getlocIDs.splice(0);
    }
    else {
        console.log("json data was not set...");
    }

    res.status(200).end()
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
                        {
                            "type": "postback",
                            "label": "パパの現在地",
                            "data": "action=getloc"
                        },
                        {
                            "type": "postback",
                            "label": "TVの禁止設定",
                            "data": "action=TVStatus"
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

            // selected GET LIVING PICTURE
            if (event.postback.data == "action=getpic") {
                set_senderIDs(getpicIDs)
                // send GET_LIVINGPIC message to socket.io clients
                console.log("GET_LIVINGPIC was fired.");

                // send GET_LIVINGPIC message to socket.io clients(target is raspberry pi.)
                io.sockets.emit("GET_LIVINGPIC");
            }
            // selected GET LOCATION
            else if (event.postback.data == "action=getloc") {
                set_senderIDs(getlocIDs)
                console.log("GET_LOCATION was fired.");

                // send firebase notification to clients(target is father's smartphone.)
                sendNotification();
            }
            // selected BAN TV
            else if (event.postback.data == "action=TVStatus") {
                set_senderIDs(getTVStsIDs)
                console.log("BAN_TV was fired.");

                // send GET_TV_STATUS message to socket.io clients(target is raspberry pi.)
                io.sockets.emit("GET_TV_STATUS");
            }
            // selected set TVban
            else if (event.postback.data.startsWith("action=banTVs")) {
                console.log("set TVbans was fired.");

                // get changeTo and cec_name from postback data
                let changeTo = event.postback.data.substr(23, 1);
                let cec_name = event.postback.data.substr(30);

                // update setting of TV bans.
                const TVbansRef = db.collection('config').doc('TVbans');

                let set_obj = {};
                set_obj[cec_name] = changeTo;
                TVbansRef.update(set_obj)
                    .then(doc => {
                        console.log('updating ' + cec_name + ' to ' + changeTo + ' was succeed.');

                        // send UPDATE_TVBAN message with name to socket.io clients(target is raspberry pi.)
                        io.sockets.emit("UPDATE_TVBAN", { 'name': cec_name });
                    })
                    .catch((error) => {
                        console.log('updating ' + cec_name + ' to ' + changeTo + ' was failed.', error);
                    });
            }
            // selected show TVban Logs
            else if (event.postback.data.startsWith("action=showBanTVLogs")) {
                console.log("show TVban Logs was fired.");

                // get changeTo and cec_name from postback data
                let cec_name = event.postback.data.substr(26);
                let logtext = cec_name + 'のログ一覧(最新20件)\n';

                // view logs of target cec_name
                db.collection('log').doc('TVStatus').collection('Logs')
                    .where('name', '=', cec_name)
                    .orderBy('date', 'desc').limit(20)
                    .get()
                    .then(querySnapshot => {
                        querySnapshot.forEach(queryDocumentSnapshot => {
                            let data = queryDocumentSnapshot.data();
                            logtext = logtext + ' ' + data.date.toDate() + ': ' + data.status + 'になりました。\n'
                        });

                        // send log data
                        client.replyMessage(event.replyToken, {
                            type: "text",
                            text: logtext,
                        });
                    });

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
