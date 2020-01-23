var emv = require('node-emv');

// SANKYO / HID READER"
var reader = require('./device/hid-reader');

// GENERIC PC/SC READER:
//var reader = require('./device/pcsc-reader');

function registerReader(onCardInserted, onCardRemoved) {
    reader.registerReader(onCardInserted, onCardRemoved);
}

function getReader() {
    return reader.getReader();
}

function createTAN(flickercode) {
    // See https://wiki.ccc-ffm.de/projekte:tangenerator:start

    // Parse the flickercode (assume it always consists
    // of the startcode and two other fields for Kontonummer and Betrag)
    let parseIx = 4; // LL04
    let len = 8;
    let startcode = flickercode.substr(parseIx,len);
    parseIx += len;
    parseIx++; // assume BCD for Kontonummer
    len = parseInt(flickercode[parseIx++]) * 2;
    let kontonummer = flickercode.substr(parseIx,len);
    parseIx += len;
    parseIx++; // assume ASCII for Betrag
    len = parseInt(flickercode[parseIx++]) * 2;
    let betrag = Buffer.from(flickercode.substr(parseIx,len), 'hex').toString('ASCII');

    console.log("startcode=" + startcode + ", kontonummer=" + kontonummer + ", betrag=" + betrag);

    // Now, assemble the core data for the HASH call later
    let hashData = [];

    hashData.push(0xE1); // DIN-66003
    hashData.push(...Buffer.from('Start-Code:', 'ASCII'));

    hashData.push(0xE0); // BCD
    hashData.push(...Buffer.from(startcode, 'hex'));

    hashData.push(0xE1); // DIN-66003
    if (startcode[1] === '7') {
        // Mask 7 Kontonummer
        hashData.push(...Buffer.from('Kontonummer', 'ASCII'));
    } else if (startcode[1] === '8') {
        // Mask 8 IBAN
        hashData.push(...Buffer.from('IBAN', 'ASCII'));
    }

    hashData.push(0xE1); // DIN-66003
    hashData.push(...Buffer.from(kontonummer, 'ASCII'));

    hashData.push(0xE1); // DIN-66003
    hashData.push(...Buffer.from('Betrag', 'ASCII'));

    hashData.push(0xE1); // DIN-66003
    hashData.push(...Buffer.from(betrag, 'ASCII'));

    hashData.push(0xB6); // B0 + 6 = B6 (6 Felder)

//    console.log(Buffer.from(hashData).toString('hex'));

    let cardNo;
    let ipb;

    // LOCK CARD
    return reader.lockReader().then(data =>

        // SELECT FILE AID TAN ANWENDUNG 'D27600002554440100'
        // AID: D2 76 00 00 25 54 44 01 00
        // RID: D2 76 00 00 25
        //      D: "national registration"
        //       2 76: ISO 3166 Country Code Deutschland
        //            00 00 25: ZKA?
        // PIX:                54 44 01 00: TAN Anwendung DF_TAN
        sendAndReceiveAPDU('00A4040C09D27600002554440100')).then(data =>

        // GET PROCESSING OPTIONS
        sendAndReceiveAPDU('80A8000002830000')).then(data =>

        // READ RECORD (read card data)
        sendAndReceiveAPDU('00B201BC00')).then(data => {
            // die letzten beiden Ziffern der Kurz-BLZ plus die 10-stellige Karten-Nr. MM NN NN NN NN NN
            cardNo = data.toString('hex').substr(6, 12);
        }).then(() =>

        // SEARCH RECORD IPB (search for '9F56' - Issuer Proprietary Bitmap)
        sendAndReceiveAPDU('00A2010F090400CE9F56000000FF00')).then(data => {
            // IPB
            ipb = data.toString('hex').substr(20, 36);
        }).then(() =>

        // SEARCH RECORD CDOL (SECCOS ab 6.0) (search for '8C' - CDOL)
        sendAndReceiveAPDU('00A2010F080400CE8C000000FF00')).then(data =>

        // VERIFY
        sendAndReceiveAPDU('00200081082C' + cardNo + 'FF')).then(data =>

        // HASH
        sendAndReceiveAPDU('002A90A0' + hexChar(hashData.length+5) + '90008081' + hexChar(hashData.length) + Buffer.from(hashData).toString('hex') + '00')).then(hash =>

        // GENERATE AC (SECCOS vor 6.0)
//        sendAndReceive('43493980AE00002B0000000000000000000000008000000000099900000000' + hash.toString('hex').substr(0,8) + '0000000000000000000020800000003400')).then(data => {
        // GENERATE AC (SECCOS ab 6.0)
        sendAndReceiveAPDU('80AE00002B'+ hash.toString('hex').substr(0,40) +'000000000000000000000000000000000000000000000000')).then(data => {
            return data.toString('hex');
            // dummy test data:
            //return '771E9F2701009F360201029F2608ECF50D2C1EAF4EE29F1007038201003100009000';
        }).then(data =>
        
        // Nutzdaten parsen
        emvParse(data.substr(4)).then(emvData => {

            let acData = "";
            emvData.forEach(tag => acData += tag.value);
            console.log("GENERATE AC DATA " + acData);

            let dataBin = bufToBitString(Buffer.from(acData, 'hex'));
            let ipbMask = bufToBitString(Buffer.from(ipb, 'hex'));
            let usedBits = "";

            console.log("DATA = " + dataBin);
            console.log("IPB  = " + ipbMask);
            for (var i=0; i<ipbMask.length; i++) if (ipbMask[i] == '1') usedBits += dataBin[i];
            console.log("RES  = " + usedBits);
            usedBits = usedBits.substr(8) + usedBits.substr(0,8);
            console.log("SHIFT= " + usedBits);
            let tan = (""+(1000000 + parseInt(usedBits, 2))).substr(1);
            console.log("TAN  = " + tan);

            // Release card:
            return reader.unlockReader().then(() => tan);
        })
    );
}

function readMaestro() {
    return reader.lockReader().then(() =>
        // SELECT AID MAESTRO: '00A4040007A000000004306000'
        sendAndReceiveAPDU('00A4040007A000000004306000')
        .then(data => {
                // EC
            return readRecord(1, 3, 4);
        })
        .then(async tag57 => {
            if (tag57) {
                return tag57;
            } else {
                // try another one:
                await readRecord(2,1,4);
                return readRecord(2,2,4);
            }
        })
        .then(tag57 => {
            return reader.unlockReader().then(() => tag57);
        })
    );
}

function readRecord(sfi, rec, offset) {
    return sendAndReceiveAPDU('00B2'+hexChar(rec)+hexChar((sfi << 3) | 4)+'00')
    .then(data => emvParse(data.toString('hex').substr(offset)))
    .then(emvData => {
        if (emvData != null) {
            console.log(emvData);
            return findEmvTag(emvData, '57');
        }
    });
}

function findEmvTag(emvData, tagName) {
    var found;
    emvData.forEach(tag => {
        if (tag.tag == tagName) found=tag;
    });
    return found;
}

function sendAndReceiveAPDU(data) {
    return reader.sendAndReceiveAPDU(data);
}

function emvParse(data) {
    return new Promise(function(resolve, reject) {
        emv.parse(data, emvData => resolve(emvData));
    });
}

function hexChar(x) {
    return ('0'+x.toString(16)).substr(-2);
}

function binChar(x) {
    return ('0000000' + x.toString(2)).substr(-8);
}

function bufToBitString(buf) {
    let result = '';
    for (var i=0; i<buf.length; i++) result += binChar(buf[i]);
    return result;
}

// -------------- THE FOLLOWING IS FOR TESTING ONLY ------------

function dumpNext(sfi, rec, maxSfi, maxRec) {
    if (rec == 1) console.log("SFI " + sfi);
    reader.sendAndReceiveAPDU('00B2'+hexChar(rec)+hexChar((sfi << 3) | 4)+'00').then(data => {
        if (sfi == maxSfi && rec == maxRec) {
            reader.unlockReader();
        } else {
            if (rec == maxRec) {rec = 1; sfi++;} else rec++;
            dumpNext(sfi, rec, maxSfi, maxRec);
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
    reader.lockReader().then(() => {
        // SELECT DFNAME
        reader.sendAndReceiveAPDU('00A40400' + hexChar(dfname.length/2) + dfname +'00').then(data => {
            // READ ALL
            dumpNext(1, 1, 3, 16);
        });
    });
}

async function emvGirocard() {
    await reader.lockReader();

    // ATR
    await sendAndReceiveAPDU('3BFF1800FF8131FE4565630D06610764000D90228000061134');

    // SELECT AID D27600002547410100 = ZKA	Germany	Girocard ATM
    await sendAndReceiveAPDU('00A4040009D2760000254741010000');

    // ?
    await sendAndReceiveAPDU('0022F302');

    // READ RECORD REC 01, SFI 24
    await sendAndReceiveAPDU('00B201C400');

    // ?
    await sendAndReceiveAPDU('0022F301');

    // GET PROCESSING OPTIONS
    await sendAndReceiveAPDU('80A800000D830B6040200280148000B0100000');

    for (let i=1; i<9; i++) {
        // READ RECORD REC i, SFI 1
        let rec = await sendAndReceiveAPDU('00B20'+i+'0C00');
        console.log(rec);
    }

    // GENERATE AC
    let res = await sendAndReceiveAPDU('80AE8000250000000000000000000000008000048000097800000001000000000000000000000000000000');
    console.log(res.toString('hex'));

}

// ----------------------------------------

module.exports.getReader = getReader;
module.exports.registerReader = registerReader;
module.exports.createTAN = createTAN;
module.exports.readMaestro = readMaestro;
module.exports.dumpMaestro = dumpMaestro;
module.exports.dumpPSE = dumpPSE;
module.exports.emvGirocard = emvGirocard;
