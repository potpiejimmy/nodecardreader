var HID = require('node-hid');
var emv = require('node-emv');

console.log(HID.devices());

var reader = new HID.HID('\\\\?\\hid#vid_077a&pid_1016#6&3b8407b&2&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}');

//reader.on("data", data => console.log("A: " + data));
//reader.on("error", err => console.log("E: " + err));

createTAN("11048816650405262080595614312C303009");

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
    hashData.push(...Buffer.from('Kontonummer', 'ASCII'));

//    hashData.push(0xE1); // DIN-66003
//    hashData.push(...Buffer.from(kontonummer, 'ASCII'));

    hashData.push(0xE1); // DIN-66003
    hashData.push(...Buffer.from('Betrag', 'ASCII'));

    hashData.push(0xE1); // DIN-66003
    hashData.push(...Buffer.from(betrag, 'ASCII'));

    hashData.push(0xB6); // B0 + 6 = B6 (6 Felder)

//    console.log(Buffer.from(hashData).toString('hex'));

    let cardNo;
    let ipb;

    // INIT 1
    return sendAndReceive("433040303030").then(data => 

        // INIT 2
        sendAndReceive("433130")).then(data =>

        // LOCK CARD
        sendAndReceive("434930")).then(data =>

        // SELECT FILE AID TAN ANWENDUNG 'D27600002554440100'
        // AID: D2 76 00 00 25 54 44 01 00
        // RID: D2 76 00 00 25
        //      D: "national registration"
        //       2 76: ISO 3166 Country Code Deutschland
        //            00 00 25: ZKA?
        // PIX:                54 44 01 00: TAN Anwendung DF_TAN
        sendAndReceive('43493900A4040C09D27600002554440100')).then(data =>

        // GET PROCESSING OPTIONS
        sendAndReceive('43493980A8000002830000')).then(data =>

        // READ RECORD (read card data)
        sendAndReceive('43493900B201BC00')).then(data => {
            // die letzten beiden Ziffern der Kurz-BLZ plus die 10-stellige Karten-Nr. MM NN NN NN NN NN
            cardNo = data.toString('hex').substr(6, 12);
        }).then(() =>

        // SEARCH RECORD IPB (search for '9F56' - Issuer Proprietary Bitmap)
        sendAndReceive('43493900A2010F090400CE9F56000000FF00')).then(data => {
            // IPB
            ipb = data.toString('hex').substr(20, 36);
        }).then(() =>

        // SEARCH RECORD CDOL (SECCOS ab 6.0) (search for '8C' - CDOL)
        sendAndReceive('43493900A2010F080400CE8C000000FF00')).then(data =>

        // VERIFY
        sendAndReceive('43493900200081082C' + cardNo + 'FF')).then(data =>

        // HASH
        sendAndReceive('434939002A90A0' + hexChar(hashData.length+5) + '90008081' + hexChar(hashData.length) + Buffer.from(hashData).toString('hex') + '00')).then(hash =>

        // GENERATE AC (SECCOS vor 6.0)
        sendAndReceive('43493980AE00002B0000000000000000000000008000000000099900000000' + hash.toString('hex').substr(0,8) + '0000000000000000000020800000003400')).then(data => {
            
            if (data.length < 10) {
                // XXX Secoder Firewall blocks, use dummy data:
                return '771E9F2701009F360201029F2608ECF50D2C1EAF4EE29F1007038201003100009000';
            } else {
                return data.toString('hex');
            }
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
            let tan = parseInt(usedBits, 2);
            console.log("TAN  = " + tan);

            // Release card:
            sendAndReceive("433040303030");
            return tan;
        })
    );
}

function sendAndReceive(data) {
    return new Promise(function(resolve, reject) {
        console.log('>>>', data);
        reader.on("error", err => {
            reader.removeAllListeners();
            console.log(err);
            reject(err);
        });
        reader.on("data", data => {
            reader.removeAllListeners();
            console.log('<<<', data.toString('hex'));
            resolve(data.slice(8, 8+data[2]));
        });
        reader.write([0x04, 0x00, data.length/2, ...Buffer.from(data,"hex")]);
    });
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
