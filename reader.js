var emv = require('node-emv');
var crypto = require('crypto');
var jspos = require('jspos');
var moment = require('moment');
var util = require('./util/util');

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
    dumpAll(Buffer.from("1PAY.SYS.DDF01", 'ASCII').toString('hex'));
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

let transactionSequenceNo = 0;

async function emvGirocard() {

    await reader.lockReader();

    let emvTags = [];

    const AID = "D27600002547410100"; // AID D27600002547410100 = ZKA Germany Girocard ATM

    // ATR
    await sendAndReceiveAPDU('3BFF1800FF8131FE4565630D06610764000D90228000061134');

    // SELECT ADF "1PAY.SYS.DDF01"
    let res = await sendAndReceiveAPDU('00A404000E315041592E5359532E444446303100');
    console.log("SELECT ADF RESULT: " + res.toString('hex'));

    // SELECT AID D27600002547410100 = ZKA	Germany	Girocard ATM
    await sendAndReceiveAPDU('00A4040009' + AID + '00');

    // ?
    await sendAndReceiveAPDU('0022F302');

    // READ RECORD REC 01, SFI 24
    await sendAndReceiveAPDU('00B201C400');

    // ?
    await sendAndReceiveAPDU('0022F301');

    // GET PROCESSING OPTIONS / INITIATE APPLICATION PROCESS
    res = await sendAndReceiveAPDU('80A800000D830B6040200280148000B0100000');

    // returns AIP (tag 82) and AFL (tag 94)
    console.log("GET PROCESSING OPTIONS RESULT: " + res.toString('hex'));
    if (res.length > 2) emvTags = emvTags.concat(await emvParse(res.slice(2).toString('hex')));

    for (let i=1; i<9; i++) {
        // READ RECORD REC i, SFI 1
        let rec = await sendAndReceiveAPDU('00B20'+i+'0C00');
        console.log("READ REC "+i+" RESULT: " + rec.toString('hex'));
        if (res.length > 2) emvTags = emvTags.concat(await emvParse(rec.slice(2).toString('hex')));
    }

    // GENERATE AC
    res = await sendAndReceiveAPDU('80AE8000250000000000000000000000008000048000097800000001000000000000000000000000000000');
    console.log("GENERATE AC RESULT: " + res.toString('hex'));
    emvTags = emvTags.concat(await emvParse(res.slice(2).toString('hex')));

    console.log("COLLECTED TAGS FROM CARD:");
    console.log(emvTags);
    console.log("-----------");

    // create tag lookup map:
    let emvTagsMap = {};
    for (let tag of emvTags) emvTagsMap[tag.tag] = {
        value: tag.value,
        data: tag.tag + tag.length + tag.value
    }

    // add terminal/transaction specific tags for BMP55 cashout
    transactionSequenceNo++;
    let date = moment(new Date());

    emvTagsMap['9F37'] = { data: '9F3704' + crypto.randomBytes(4).toString('hex') }; // Unpredictable Number
    emvTagsMap['95']   = { data: '95058000048000' }; // Terminal Verification Results
    emvTagsMap['9A']   = { data: '9A03' + date.format('YYMMDD') }; // Transaction Date YYMMDD
    emvTagsMap['9C']   = { data: '9C0101' }; // Transaction Type 01
    emvTagsMap['5F2A'] = { data: '5F2A020978' }; // Transaction Currency Code 0978
    emvTagsMap['9F1A'] = { data: '9F1A020280' }; // Terminal Country Code 0280
    emvTagsMap['9F34'] = { data: '9F3403020300' }; // Cardholder Verification Method (CVM) Results 020300 (online)
    emvTagsMap['9F33'] = { data: '9F3303604020' }; // Terminal Capabilities 604020
    emvTagsMap['9F35'] = { data: '9F350114' }; // Terminal Type 14
    emvTagsMap['9F1E'] = { data: '9F1E08F1F2F3F4F5F6F7F8' }; // Interface Device (IFD) Serial Number '12345678'
    emvTagsMap['84']   = { data: '8409' + AID }; // Dedicated File (DF) Name D27600002547410100
    emvTagsMap['9F09'] = { data: '9F09020002' }; // Application Version Number, Terminal 0002
    emvTagsMap['9F41'] = { data: '9F4104' + (""+(100000000+transactionSequenceNo)).substr(1) }; // Transaction Sequence Counter
    emvTagsMap['9F02'] = { data: '9F0206000000001000' }; // Amount, Authorised (Numeric)

    console.log(emvTagsMap);

    res = await buildISO200(date, emvTagsMap);

    await reader.unlockReader();

    return res;
}

async function buildISO200(date, emvTags) {
    let { IFB_NUMERIC, IFB_BITMAP, IFB_LLNUM, IFB_LLLNUM, IF_CHAR, IFB_LLCHAR, IFB_LLLCHAR, IFB_BINARY, IFB_LLBINARY, IFB_LLLBINARY, IFB_AMOUNT } = jspos.packer;
    
    let OPT_ISO_MSG_FORMAT = [
        /*MTI*/            new IFB_NUMERIC(4, "Message Type Indicator", true),
        /*PRIMARY BITMAP*/ new IFB_BITMAP(8, "Bitmap"),
    ];
    
    /* define ISO bitmaps */
    OPT_ISO_MSG_FORMAT[2]  = new IFB_BINARY(12, "Track2PAN");
    OPT_ISO_MSG_FORMAT[3]  = new IFB_BINARY(3, "Abwicklungskennzeichen");
    OPT_ISO_MSG_FORMAT[4]  = new IFB_BINARY(6, "Amount");
    OPT_ISO_MSG_FORMAT[11] = new IFB_BINARY(3, "Tracenummer");
    OPT_ISO_MSG_FORMAT[12] = new IFB_BINARY(3, "Uhrzeit");
    OPT_ISO_MSG_FORMAT[13] = new IFB_BINARY(2, "Datum");
    OPT_ISO_MSG_FORMAT[14] = new IFB_BINARY(2, "Expiry Date");
    OPT_ISO_MSG_FORMAT[18] = new IFB_BINARY(2, "Merchant Type");
    OPT_ISO_MSG_FORMAT[22] = new IFB_BINARY(2, "Entry Mode");
    OPT_ISO_MSG_FORMAT[23] = new IFB_BINARY(2, "Card Sequence No");
    OPT_ISO_MSG_FORMAT[25] = new IFB_BINARY(1, "Condition Code");
    OPT_ISO_MSG_FORMAT[26] = new IFB_BINARY(1, "Max PIN");
    OPT_ISO_MSG_FORMAT[33] = new IFB_BINARY(5, "ID zwischengeschalteter Rechner / PS-ID");
    OPT_ISO_MSG_FORMAT[35] = new IFB_BINARY(21, "Track 2");
    OPT_ISO_MSG_FORMAT[39] = new IFB_BINARY(1, "Antwortcode");
    OPT_ISO_MSG_FORMAT[41] = new IFB_BINARY(8, "Terminal-ID");
    OPT_ISO_MSG_FORMAT[42] = new IFB_BINARY(15, "Betreiber-BLZ");
    OPT_ISO_MSG_FORMAT[52] = new IFB_BINARY(8, "PAC");
    OPT_ISO_MSG_FORMAT[53] = new IFB_BINARY(8, "Sicherheitsverfahren");
    OPT_ISO_MSG_FORMAT[55] = new IFB_BINARY(0, "Chip Data");
    OPT_ISO_MSG_FORMAT[57] = new IFB_BINARY(37, "Verschlüsselungsparameter");
    OPT_ISO_MSG_FORMAT[61] = new IFB_BINARY(10, "Online-Zeitpunkt");
    OPT_ISO_MSG_FORMAT[64] = new IFB_BINARY(8, "MAC");

    let isoPacker = new jspos.ISOBasePackager();
    isoPacker.setFieldPackager(OPT_ISO_MSG_FORMAT);

    let isoMsg = isoPacker.createISOMsg();
    isoMsg.setMTI("0200"); /* MSGTYPE 0200 */
    isoMsg.setField(2, "F1F0" + emvTags['5A'].value); // TRACK2PAN
    isoMsg.setField(3, "010113"); /* AKZ */
    isoMsg.setField(4, "000000001000"); /* AMOUNT */
    isoMsg.setField(11, (""+(1000000+transactionSequenceNo)).substr(1)); /* TRANSACT NO */
    isoMsg.setField(12, date.format('HHmmss')); // DATE
    isoMsg.setField(13, date.format('MMDD')); // TIME
    isoMsg.setField(14, emvTags['57'].value.substr(20,4)); // EXPIRY DATE
    isoMsg.setField(18, "6011"); // MERCHANT TYPE
    isoMsg.setField(22, "0501"); // ENTRY MODE
    isoMsg.setField(23, "0001"); // CARD SEQUENCE NO
    isoMsg.setField(25, "62"); // CONDITION CODE
    isoMsg.setField(26, "12"); // MAXPIN
    isoMsg.setField(33, "F0F3221000"); // COMP ID
    isoMsg.setField(35, "F1F9" + emvTags['57'].value); // TRACK2
    isoMsg.setField(41, "F0F0F0F8F8F8F9F1"); // TERMINAL ID: '00088891'
    isoMsg.setField(42, "F0F0F0F0F0F0F0F4F8F0F5F0F1F6F1"); // BLZ: '000000048050161'
    isoMsg.setField(52, "6B3941947F1699DD"); // PAC // XXX
    isoMsg.setField(53, "0102110002000000"); // SECURITY DATA

    let bmp55 = emvTags['9F26'].data + 
                emvTags['9F27'].data +
                emvTags['9F36'].data +
                emvTags['9F37'].data +
                emvTags['9F10'].data +
                emvTags['95'].data +
                emvTags['9A'].data +
                emvTags['9C'].data +
                emvTags['5F2A'].data +
                emvTags['82'].data +
                emvTags['9F1A'].data +
                emvTags['9F33'].data +
                emvTags['9F34'].data +
                emvTags['9F35'].data +
                emvTags['9F1E'].data +
                emvTags['84'].data +
                emvTags['9F09'].data +
                emvTags['9F41'].data +
                emvTags['9F02'].data;

    let bmp55Len = bmp55.length / 2;

    isoMsg.setField(55, util.asciiToEbcdic(util.padNumber(bmp55Len, 3)).toString('hex') + bmp55); // SECURITY DATA
    isoPacker.getFieldPackager(55).setLength(3 + bmp55Len); // CHIPDATA

    isoMsg.setField(57, "F0F3F40104E92F963D320A2416803B5D6AAF38D0B4075D55DF820D5AD7598E946C278508DF"); // SESSIONKEY
    isoMsg.setField(61, "F0F0F720210101000000"); // ONLINE TIME
    isoMsg.setField(64, "0000000000000000"); /* set empty BMP64 before calculating MAC */

    let msg = isoMsg.pack();

    let res = Buffer.from(msg).toString('hex');
    console.log(res);

    return res;
}

// ----------------------------------------

module.exports.getReader = getReader;
module.exports.registerReader = registerReader;
module.exports.createTAN = createTAN;
module.exports.readMaestro = readMaestro;
module.exports.dumpMaestro = dumpMaestro;
module.exports.dumpPSE = dumpPSE;
module.exports.emvGirocard = emvGirocard;
