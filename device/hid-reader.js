var HID = require('node-hid');

console.log(HID.devices());

var reader;
var lastCardStatus = -1;
var pausePolling;

function registerReader(onCardInserted, onCardRemoved) {
    reader = new HID.HID('\\\\?\\hid#vid_077a&pid_1016#6&3b8407b&2&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}');

    // Initialize ICRW and LED green:
    unlockReader().then(() => 
    pollCardState(onCardInserted, onCardRemoved));
}

function getReader() {
    return reader;
}

function pollCardState(onCardInserted, onCardRemoved) {
    if (pausePolling) {
        setTimeout(()=>pollCardState(onCardInserted, onCardRemoved), 1000);
        return;
    }

    // C'31' Inquire status: 30H Presence and position of card
    sendAndReceive("433130").then(data => {
        let internalCardStatus = data.slice(3,5).toString();
        // "00" = No card
        // "10" = Card present in slot, not fully inserted
        // "30" = Card fully inserted
        let cardStatus = internalCardStatus === "30" ? 1/*IN*/ : 0/*OUT*/;
        if (cardStatus != lastCardStatus) {
            lastCardStatus = cardStatus;
            if (cardStatus) onCardInserted();
            else onCardRemoved();
        }
        setTimeout(()=>pollCardState(onCardInserted, onCardRemoved), 1000);
    });
}

function sendAndReceiveAPDU(data) {
    return sendAndReceive('434939' + data, true).then(res => res.slice(5));
}

function sendAndReceive(data, dolog) {
    return new Promise(function(resolve, reject) {
        reader.on("error", err => {
            reader.removeAllListeners();
            console.log(err);
            reject(err);
        });
        reader.on("data", data => {
            reader.removeAllListeners();
            if (dolog) console.log('<<<', data.toString('hex'));
            // TODO receiving multiple blocks not handled here, assume data always in one block
            resolve(data.slice(3, 3+data[2]));
        });
        let sendBuf = [0x00, data.length/2, ...Buffer.from(data,"hex")];
        let MAX_SENDBUF_LEN = 63;
        while (sendBuf.length) {
            let chunk = [0x04, ...sendBuf.slice(0,MAX_SENDBUF_LEN)];
            if (dolog) console.log('>>>', Buffer.from(chunk).toString("hex"));
            reader.write(chunk);
            sendBuf = sendBuf.slice(MAX_SENDBUF_LEN);
        }
    });
}

function lockReader() {
    pausePolling = true; // do not poll during communication

    // LOCK CARD
    return sendAndReceive("434930").then(() =>
    // LED ORANGE
    sendAndReceive("433333"));
}

function unlockReader() {
    // RELEASE CARD
    return sendAndReceive("433040303030").then(() =>
    // LED GREEN
    sendAndReceive("433332").then(() => {
        pausePolling = false; // continue card state polling
    }));
}

// ----------------------------------------

module.exports.registerReader = registerReader;
module.exports.getReader = getReader;
module.exports.lockReader = lockReader;
module.exports.unlockReader = unlockReader;
module.exports.sendAndReceiveAPDU = sendAndReceiveAPDU;
