var ModbusRTU = require("modbus-serial");
const express = require("express");
const { exec } = require('child_process');
const restart1Command = "pm2 restart prod-modbus"

const app = express();

// Timestamp for which returns current date and time 
var noww = new Date().toLocaleString(undefined, { timeZone: 'Asia/Kolkata' });
console.log(`[ STARTING: ${noww} ]`)
var startTime = + new Date();

// Modbus TCP configs
var client = new ModbusRTU();
const slaveID = 1;

// Modbus Addresses
const coil_read_addresses = [];

const register_read_addresses = [];

const coil_write = [];

var data = {
    user: 0,
    connection: '',
    data_dump: false, // Store to DB
    protocol: {
        type: "tcp", // tcp or rtu
        tcp: {
            ip: "192.168.0.100",
            port: "500",
        },
        rtu: {
            port: "/dev/ttyUSB0",
            baudrate: 9600,
            parity: "none",
        }
    }, 
    slaveId: 0,
    scanTime: 1000, // Milliseconds 
    coil_read_addresses: [], 
    coil_read_offset: [], 
    coil_read_data: [],
    register_read_addresses: [],
    register_read_offset: [],
    register_read_data: [],
};

var mbsTimeout = 1000;

var GOOD_CONNECT = "GOOD_CONNECT";
var FAILED_CONNECT = "FAILED_CONNECT";
var PASS_READ_TIME = "PASS_READ_TIME"
var FAIL_READ_TIME = "FAIL_READ_TIME"

var PASS_READ_COILS = "PASS_READ_COILS";
var PASS_WRITE_COIL = "PASS_WRITE_COIL";
var FAIL_WRITE_COIL = "FAIL_WRITE_COIL";

var PASS_READ_REGS = "PASS_READ_REGS"
var PASS_REGS_WRITE = "PASS_REGS_WRITE";
var FAIL_REGS_WRITE = "FAIL_REGS_WRITE";

//  Make physical connection MODBUS-RTU
var connectClient = function () {

    // set requests parameters
    client.setID(`${data.slaveId}`);
    client.setTimeout(`${data.scanTime}`);


    function connectTCP() {
        client.connectTCP(`${data.protocol.tcp.ip}`)
            .then(function () {
                mbsState = GOOD_CONNECT;
                data.connection = true;
                console.log(`[ CONNECTED ]`)
            })
            .then(function () {
                runModbus()
            })
            .catch(function (e) {
                mbsState = FAILED_CONNECT;
                data.connection = false;
                console.log(`[ FAILED TO CONNECT ]`)
                console.log(e);
            });
        
    }


    function connectRTU() {
        client.connectRTUBuffered(`${data.protocol.rtu.port}`, { baudRate: `${data.protocol.rtu.baudrate}`, parity: `${data.protocol.rtu.parity}`})
            .then(function () {
                mbsState = GOOD_CONNECT;
                data.connection = true;
                console.log(`[ CONNECTED RTU ]`)
            })
            .then(function () {
                // runModbus()
                readRegs1()
            })
            .catch(function (e) {
                mbsState = FAILED_CONNECT;
                data.connection = false;
                console.log(`[ FAILED TO CONNECT ]`)
                console.log(e);
            });
    }

}

// Make connection
var disconnectClient = function () {

    // close port (NOTE: important in order not to create multiple connections)
    //client.close();

    
    // try to connect
    
}

// Linters
function _2x16bitTo32bit(reg1, reg2, divider) {
    let integer
    divider = divider || 1;

    reg2 == 0 ? integer = reg1 / divider : integer = (((2 ** 16) * reg2) + reg1) / divider;

    return integer
}

function signedDecToDec(integer, nbit) {

    let result
    function uintToInt(uint, nbit) {
        nbit = +nbit || 32;
        if (nbit > 32) throw new RangeError('uintToInt only supports ints up to 32 bits');
        uint <<= 32 - nbit;
        uint >>= 32 - nbit;
        return uint;
    }

    integer < (2 ** 16) ? result = integer : result = uintToInt(integer, nbit)

    return result
}

function signedDecto2x16bitArray(value, bitCount) {
    let binaryStr;
    bitCount = bitCount || 32;

    if (value >= 0) {
        let twosComp = value.toString(2);
        binaryStr = padAndChop(twosComp, '0', (bitCount || twosComp.length));
    } else {
        binaryStr = (Math.pow(2, bitCount) + value).toString(2);

        if (Number(binaryStr) < 0) {
            return undefined
        }
    }

    var digit = parseInt(binaryStr, 2);

    // console.log(digit)

    var reg2 = parseInt(digit / (2 ** 16))
    var reg1 = digit - ((2 ** 16) * reg2)

    return [reg1, reg2];
}

function padAndChop(str, padChar, length) {
    return (Array(length).fill(padChar).join('') + str).slice(length * -1);
}

// Run MODBUS
var runModbus = function () {
    var nextAction;
    switch (mbsState) {
        case CODE_INIT:
            nextAction = connectClient;
            break;

        case FAILED_CONNECT:
            nextAction = connectClient;
            break;

        case GOOD_CONNECT:
            nextAction = read_coils;
            break;

        case PASS_READ_COILS:
            nextAction = read_regs;
            break;

        case PASS_READ_REGS: 
            nextAction = read_coils;
            break;

        case PASS_READ_COILS:
            nextAction = read_regs;
            break;

        case PASS_WRITE_COIL || FAIL_WRITE_COIL:
            nextAction = read_coils;
            break;

        case PASS_REGS_WRITE || FAIL_REGS_WRITE:
            nextAction = read_regs;
            break;

        // nothing to do, keep scanning until actionable case
        default:
    }

    // console.log(mbsState);
    // console.log(nextAction);

    // if (readfailed > 50) {
    //     payload.status = false;
    // } else {
    //     payload.status = true;
    // }

    if (nextAction !== undefined) {
        nextAction();
    } else {
        read_regs();
    }

    // set for next run
    setTimeout(runModbus, `${data.scanTime}`);
}


var read_coils = function () {
    mbsState = PASS_READ_COILS;

    client.readCoils(`${data.coil_read_addresses[0]}`, `${data.coil_read_offset[0]}`)
        .then(function (read) {
            data.coil_read_data = read.data
        })
        .catch(function (e) {
            console.error(`[ Adress ${data.coil_read_addresses[0]} garbage ]`)
            readfailed++;
        })
}

var read_regs = function () {
    mbsState = PASS_READ_REGS;

    client.readHoldingRegisters(`${data.register_read_addresses[0]}`, `${data.register_read_offset[0]}`)
        .then(function (read) {
            data.register_read_data = read.data
        })
        .catch(function (e) {
            console.error(`[ Adress ${data.register_read_addresses[0]} garbage ]`)
            readfailed++;
        })
}

function restartprodmodbus() {
    exec(restart1Command, (err, stdout, stderr) => {
        // handle err if you like!
        console.log(`[ RESTARTING: prod-modbus ]`);
        console.log(`${stdout}`);
    });
}

app.use("/api/data", (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.json(data);
});

app.get("/api/set/:type/:address/:value", (req, res) => {
    const c = req.params.type; //
    const a = req.params.address;
    const b = req.params.value;
    
    writelog = () => {

        // _new.write(`${data.user}.modbuslogs`)
        //     .tag({
        //     })
        //     .field({
        //         user: data.user,  // 2
        //         type: c
        //         parameter: a,  // 2
        //         newvalue: b,  // 2
        //     })
        //     .then(() => console.info(`[ LOG ENTRY DONE ${data.user} ]`))
        //     .catch(console.error);
    }
    if (c == "coil") {
        client.writeCoil(`${a}`, `${b}`)
            .then(function (d) {
                console.log(`Address ${a} set to ${b}`);
                res.json({ message: `[ UPDATED ${a} to ${b} ]` });
                mbsState = PASS_WRITE_COIL;
            })
            .then(
                function () {
                    // Write to DB
                }
            )
            .catch(function (e) {
                console.log(e.message);
                mbsState = FAIL_WRITE_COIL;
                res.json({ message: `[ FAILED ]` });
            })    
    }
    else if (c == "reg") {    
        client.writeRegister(`${a}`, `${b}`)
            .then(function (d) {
                console.log(`Address ${a} set to ${b}`);
                mbsState = PASS_REGS_WRITE;
                res.json({ message: `[ UPDATED ${a} to ${b} ]` });
            })
            .catch(function (e) {
                mbsState = FAIL_REGS_WRITE;
                console.log(e.message);
                res.json({ message: `[ FAILED ]` });
            })
    }
    else if (c == "signedreg32") {    
        client.writeRegisters(`${a}`, signedDecto2x16bitArray(parseInt(`${b}`)))
            .then(function (d) {
                console.log(`Address ${a} set to ${signedDecto2x16bitArray(parseInt(`${b}`))}`);
                mbsState = PASS_REGS_WRITE;
                res.json({ message: `[ UPDATED ${a} to ${signedDecto2x16bitArray(parseInt(`${b}`))} ]` });
            })
            .catch(function (e) {
                mbsState = FAIL_REGS_WRITE;
                console.log(e.message);
                res.json({ message: `[ FAILED ]` });
            })
    }
});

// Start Server
const port = 3128;
app.listen(port, () => console.log(`Server running on port ${port} 🔥`));