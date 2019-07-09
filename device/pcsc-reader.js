var pcsclite = require('pcsclite');
var pcsc = pcsclite();

var reader;
var protocol;

// --- start public interface methods ---

function registerReader(onCardInserted, onCardRemoved) {
    pcsc.on('reader', function(r) { 
        console.log('New reader detected', r.name);
        reader = r;

        r.on('status', function(status) {
            var changes = this.state ^ status.state;
            if ((changes & this.SCARD_STATE_EMPTY) && (status.state & this.SCARD_STATE_EMPTY)) {
                console.log("card removed"); /* card removed */
                reader.disconnect(reader.SCARD_LEAVE_CARD, function(err) {});
                onCardRemoved();
            } else if ((changes & this.SCARD_STATE_PRESENT) && (status.state & this.SCARD_STATE_PRESENT)) {
                console.log("card inserted"); /* card inserted */
                onCardInserted();
                // for testing:
//                dumpMaestro();
            }
        });
    });
}

function getReader() {
    return reader;
}

function lockReader() {
    //console.log("EXCLUSIVE: " + reader.SCARD_SHARE_EXCLUSIVE);
    //console.log("SHARED: " + reader.SCARD_SHARE_SHARED);
    return new Promise((resolve, reject) => {
        reader.connect({ share_mode : reader.SCARD_SHARE_SHARED }, function(err, prot) {
            if (err || !prot) { console.log(err); reject(err); }
            protocol = prot;
            resolve();
        });
    });
}

function unlockReader() {
    return new Promise((resolve, reject) => 
        reader.disconnect(reader.SCARD_LEAVE_CARD, err => {
            if (err) reject(err);
            resolve();
        }));
}

function sendAndReceiveAPDU(data) {
    return new Promise(function(resolve, reject) {
        console.log('>>>', data);
        reader.transmit(new Buffer(data,'hex'), 512, protocol, function(err, data) {
            if (err) {
                console.log(err); 
                reject(err);
            } else {
                console.log('<<<', data.toString('hex'));
                resolve(data);
            }
        });
    });
}

// ----------------------------------------

module.exports.registerReader = registerReader;
module.exports.getReader = getReader;
module.exports.lockReader = lockReader;
module.exports.unlockReader = unlockReader;
module.exports.sendAndReceiveAPDU = sendAndReceiveAPDU;
