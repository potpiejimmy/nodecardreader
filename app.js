var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);

var reader = require('./hid-reader');
var Notifier = require('./notifier');

var notifier = new Notifier();

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.listen(3004, function () {
  console.log('nodecardreader listening on port 3004');
});

reader.registerReader(
    function() {
        global.cardStatus = "IN";
        expressWs.getWss().clients.forEach(function(client) {
            client.send(JSON.stringify({"cardstatus":global.cardStatus, "severity":"success", "summary":"Status", "detail":"Card inserted."}));
        });
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
