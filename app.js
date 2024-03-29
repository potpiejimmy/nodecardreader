var fs = require('fs');
var https = require('https');
var express = require('express');
var app = express();
var cfg = require('./config');
const fetch = require('node-fetch');
const open = require('open');

let doCardAuth = false;

var reader = require('./reader');
var Notifier = require('./notifier');

var notifier = new Notifier();

var server = https.createServer({
    key: fs.readFileSync('./ssl/ssl.pem'),
    cert: fs.readFileSync('./ssl/ssl.crt')
}, app);

var expressWs = require('express-ws')(app, server);

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

server.listen(3004, function () {
  console.log('nodecardreader listening on port 3004');
});

if (process.argv[2] == '--cardauth') {
    doCardAuth = true;
    console.log("Authenticate cards against " + cfg.CARD_AUTH_SERVICE_URL);
}

reader.registerReader(
    function() {
        global.cardStatus = "IN";
        expressWs.getWss().clients.forEach(function(client) {
            client.send(JSON.stringify({"cardstatus":global.cardStatus, "severity":"success", "summary":"Status", "detail":"Card inserted."}));
        });
        if (doCardAuth) authenticateCard();
    },
    function() {
        global.cardStatus = "OUT";
        expressWs.getWss().clients.forEach(function(client) {
            client.send(JSON.stringify({"cardstatus":global.cardStatus, "severity":"warn", "summary":"Status", "detail":"Card removed."}));
        });
    }
);

/**
 * This websocket endpoint notifies about card insertion and removal
 */
app.ws('/status', (ws, req) => {
    console.log('Websocket connected.');
    // Note: All open websockets contained in expressWs.getWss().clients.
    ws.send(JSON.stringify({"cardstatus":global.cardStatus}));
});

/**
 * Creates a ChipTAN
 */
app.get('/tan', (req, res) => {
    console.log('CREATE TAN, flickercode=' + req.query.flickercode);
    if (!reader.getReader()) res.send({"severity":"error", "summary":"Error", "detail":"Card reader not connected."});
    else {
        // if not creating TAN already, start creating TAN
        if (!notifier.getObservers('tan')) {
            reader.createTAN(req.query.flickercode ? req.query.flickercode : "11048816650405262080595614312C303009")
            .then(tan => notifier.notifyObservers('tan', tan))
            .catch(err => { console.log(err); notifier.notifyObservers('tan', err); });
        }

        // add observer for TAN creation
        notifier.addObserver('tan', tan => res.send({tan:tan}));
    }
});

/**
 * Reads some basic card data
 */
app.get('/card', (req, res) => {
    console.log('GET CARD');
    if (!reader.getReader()) res.send({"severity":"error", "summary":"Error", "detail":"Card reader not connected."});
    else {
        // if not reading already, start reading of card:
        if (!notifier.getObservers('card')) {
            reader.readMaestro().then(tag57 => {
                notifier.notifyObservers('card', tag57);
            }).catch(err => { console.log(err); notifier.notifyObservers('card', err);});
        }

        // add observer for card reading result
        notifier.addObserver('card', tag57 => {
            if (tag57 && tag57.value) {
                res.send({
                    routingcode:  tag57.value.substr(3,5),
                    branch:       tag57.value.substr(5,3),
                    account:      tag57.value.substr(8,10),
                    shortaccount: tag57.value.substr(9,7),
                    subaccount:   tag57.value.substr(16,2),
                    t2emv:        tag57.value
                });
            } else {
                res.send({});
            }
        });
    }
});

app.get('/emv', (req, res) => {
    reader.emvGirocard().then( data => res.send('<a href="https://iso.doogetha.com/?msg='+data+'">ISO message</a>') );
});

// card authentication

async function authenticateCard() {
    let tag57 = await reader.readMaestro();
    console.log("READ CARD: " + (tag57 && tag57.value));

    if (tag57) {
        console.log("Authenticating card against: " + cfg.CARD_AUTH_SERVICE_URL);
        let result = await fetch(cfg.CARD_AUTH_SERVICE_URL, {
            method: 'POST',
            body: JSON.stringify({ t2: tag57.value }),
            headers: {
                'Content-Type': 'application/json',
                "DN-API-KEY": cfg.CARD_AUTH_API_KEY,
                "DN-API-SECRET": cfg.CARD_AUTH_API_SECRET
            }
        });
        let data = await result.json();
        console.log("RESULT: " + JSON.stringify(data));
        if (data.url) {
            let url = data.url + "&nonce=" + data.nonce;
            console.log("Opening " + url);
            open(url);
        }
    }
}
