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

// -------------- THE FOLLOWING IS FOR TESTING ONLY ------------

function dumpNext(protocol, sfi, rec, maxSfi, maxRec) {
    if (rec == 1) console.log("SFI " + sfi);
    sendAndReceive(protocol, '00B2'+hexChar(rec)+hexChar((sfi << 3) | 4)+'00').then(data => {
        if (sfi == maxSfi && rec == maxRec) {
            reader.disconnect(reader.SCARD_LEAVE_CARD, function(err) {});
        } else {
            if (rec == maxRec) {rec = 1; sfi++;} else rec++;
            dumpNext(protocol, sfi, rec, maxSfi, maxRec);
        }
    });
}

function dumpPSE() {
    // SELECT 1PAY.SYS.DDF01 or 2PAY.SYS.DDF01 (contactless)
    dumpAll(new Buffer("1PAY.SYS.DDF01", 'ASCII').toString('hex'));
}

function dumpMaestro() {
    dumpAll("A0000000043060");
}

function dumpAll(dfname) {
    reader.connect({ share_mode : reader.SCARD_SHARE_SHARED }, function(err, protocol) {
        if (err) console.log(err); 
        else {
            console.log('Protocol(', reader.name, '):', protocol);
            // SELECT DFNAME
            sendAndReceive(protocol, '00A40400' + hexChar(dfname.length/2) + dfname +'00').then(data => {
                // READ ALL
                dumpNext(protocol, 1, 1, 3, 16);
            });
        }
    });
}

// ----------------------------------------

module.exports.registerReader = registerReader;
module.exports.getReader = getReader;
module.exports.lockReader = lockReader;
module.exports.unlockReader = unlockReader;
module.exports.sendAndReceiveAPDU = sendAndReceiveAPDU;
