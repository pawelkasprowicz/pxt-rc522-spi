//% color="#D35400" icon="\uf02a" block="RFID RC522"
namespace rc522 {
    const SS = DigitalPin.P16;

    let initialized = false;
    let authenticated = false;
    let selectedUID: number[] = [];
    let currentUID = "";

    function writeReg(reg: number, value: number): void {
        pins.digitalWritePin(SS, 0);
        pins.spiWrite((reg << 1) & 0x7E);
        pins.spiWrite(value & 0xFF);
        pins.digitalWritePin(SS, 1);
    }

    function readReg(reg: number): number {
        pins.digitalWritePin(SS, 0);
        pins.spiWrite(((reg << 1) & 0x7E) | 0x80);
        let value = pins.spiWrite(0);
        pins.digitalWritePin(SS, 1);
        return value;
    }

    function setBits(reg: number, mask: number): void {
        writeReg(reg, readReg(reg) | mask);
    }

    function clearBits(reg: number, mask: number): void {
        writeReg(reg, readReg(reg) & (0xFF ^ mask));
    }

    function communicate(data: number[], lastBits: number): number[] {
        writeReg(0x01, 0);
        writeReg(0x04, 0x7F);
        writeReg(0x0A, 0x80);

        for (let i = 0; i < data.length; i++) {
            writeReg(0x09, data[i]);
        }

        writeReg(0x0D, lastBits);
        writeReg(0x01, 0x0C);
        setBits(0x0D, 0x80);

        let completed = false;

        for (let i = 0; i < 200; i++) {
            let irq = readReg(0x04);

            if ((irq & 0x30) != 0) {
                completed = true;
                break;
            }

            if ((irq & 0x01) != 0) {
                break;
            }

            control.waitMicros(100);
        }

        clearBits(0x0D, 0x80);

        if (!completed || (readReg(0x06) & 0x13) != 0) {
            return [];
        }

        let count = readReg(0x0A);
        let result: number[] = [];

        for (let i = 0; i < count; i++) {
            result.push(readReg(0x09));
        }

        return result;
    }

    function calculateCRC(data: number[]): number[] {
        writeReg(0x01, 0);
        writeReg(0x05, 0x04);
        writeReg(0x0A, 0x80);

        for (let i = 0; i < data.length; i++) {
            writeReg(0x09, data[i]);
        }

        writeReg(0x01, 0x03);

        let ready = false;

        for (let i = 0; i < 200; i++) {
            if ((readReg(0x05) & 0x04) != 0) {
                ready = true;
                break;
            }

            control.waitMicros(100);
        }

        writeReg(0x01, 0);

        if (!ready) {
            return [];
        }

        return [readReg(0x22), readReg(0x21)];
    }

    function withCRC(data: number[]): number[] {
        let crc = calculateCRC(data);

        if (crc.length != 2) {
            return [];
        }

        let result: number[] = [];

        for (let i = 0; i < data.length; i++) {
            result.push(data[i]);
        }

        result.push(crc[0]);
        result.push(crc[1]);

        return result;
    }

    function hexByte(value: number): string {
        let digits = "0123456789ABCDEF";
        return digits.charAt((value >> 4) & 15)
            + digits.charAt(value & 15);
    }

    function stopCrypto(): void {
        writeReg(0x01, 0);
        clearBits(0x08, 0x08);
        authenticated = false;
    }

    function validBlock(block: number): boolean {
        if (block < 1 || block > 63) {
            return false;
        }

        // Bloki 3, 7, 11...63 zawierają klucze
        // i konfigurację dostępu do sektorów.
        if (block % 4 == 3) {
            return false;
        }

        return true;
    }

    function findCard(): boolean {
        if (!initialized) {
            return false;
        }

        stopCrypto();
        selectedUID = [];
        currentUID = "";

        // WUPA pozwala ponownie wykrywać kartę
        // pozostającą w polu czytnika.
        let response = communicate([0x52], 7);

        if (response.length != 2) {
            return false;
        }

        response = communicate([0x93, 0x20], 0);

        // Ta wersja obsługuje UID 4-bajtowe.
        if (response.length != 5) {
            return false;
        }

        let bcc = response[0] ^ response[1]
            ^ response[2] ^ response[3];

        if (bcc != response[4]) {
            return false;
        }

        for (let i = 0; i < 4; i++) {
            selectedUID.push(response[i]);
            currentUID += hexByte(response[i]);
        }

        return true;
    }

    function selectCard(): boolean {
        if (selectedUID.length != 4) {
            return false;
        }

        let command: number[] = [0x93, 0x70];

        for (let i = 0; i < 4; i++) {
            command.push(selectedUID[i]);
        }

        command.push(
            selectedUID[0] ^ selectedUID[1]
            ^ selectedUID[2] ^ selectedUID[3]
        );

        let response = communicate(withCRC(command), 0);

        return response.length == 3;
    }

    function authenticate(block: number): boolean {
        authenticated = false;

        if (selectedUID.length != 4) {
            return false;
        }

        writeReg(0x01, 0);
        writeReg(0x04, 0x7F);
        writeReg(0x0A, 0x80);

        // MIFARE Classic Key A: FF FF FF FF FF FF
        let command: number[] = [
            0x60, block,
            0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF
        ];

        for (let i = 0; i < 4; i++) {
            command.push(selectedUID[i]);
        }

        for (let i = 0; i < command.length; i++) {
            writeReg(0x09, command[i]);
        }

        writeReg(0x01, 0x0E);

        for (let i = 0; i < 200; i++) {
            let irq = readReg(0x04);

            if ((irq & 0x10) != 0) {
                break;
            }

            if ((irq & 0x01) != 0) {
                break;
            }

            control.waitMicros(100);
        }

        authenticated = (readReg(0x08) & 0x08) != 0;
        return authenticated;
    }

    function prepare(block: number): boolean {
        if (!validBlock(block)) {
            return false;
        }

        if (!findCard()) {
            return false;
        }

        if (!selectCard()) {
            return false;
        }

        return authenticate(block);
    }

    function ackOK(response: number[]): boolean {
        if (response.length != 1) {
            return false;
        }

        return (response[0] & 0x0F) == 0x0A;
    }

    function readBlock(block: number): number[] {
        let response = communicate(
            withCRC([0x30, block]), 0
        );

        if (response.length != 18) {
            return [];
        }

        return response;
    }

    function writeBlock(block: number, data: number[]): boolean {
        if (data.length != 16) {
            return false;
        }

        let response = communicate(
            withCRC([0xA0, block]), 0
        );

        if (!ackOK(response)) {
            return false;
        }

        response = communicate(withCRC(data), 0);

        return ackOK(response);
    }

    /**
     * Uruchamia czytnik RC522.
     * SPI: P13 SCK, P14 MOSI, P15 MISO, P16 SS.
     */
    //% block="RC522 initialize"
    //% weight=100
    export function initialize(): void {
        pins.digitalWritePin(SS, 1);
        pins.spiPins(
            DigitalPin.P14,
            DigitalPin.P15,
            DigitalPin.P13
        );
        pins.spiFormat(8, 0);
        pins.spiFrequency(1000000);

        basic.pause(100);

        writeReg(0x01, 0x0F);
        basic.pause(100);

        writeReg(0x2A, 0x80);
        writeReg(0x2B, 0xA9);
        writeReg(0x2C, 0x03);
        writeReg(0x2D, 0xE8);
        writeReg(0x15, 0x40);
        writeReg(0x11, 0x3D);

        setBits(0x14, 0x03);

        initialized = true;
        authenticated = false;
    }

    /**
     * Sprawdza, czy czytnik wykrywa kartę.
     */
    //% block="RC522 card detected"
    //% weight=90
    export function cardDetected(): boolean {
        return findCard();
    }

    /**
     * Odczytuje UID karty jako tekst HEX.
     */
    //% block="RC522 read UID"
    //% weight=80
    export function readUID(): string {
        if (findCard()) {
            return currentUID;
        }

        return "";
    }

    /**
     * Odczytuje tekst z bloku karty MIFARE Classic.
     * @param block numer bloku pamięci
     */
    //% block="RC522 read text block %block"
    //% block.min=1 block.max=62 block.defl=4
    //% weight=70
    export function readText(block: number): string {
        if (!prepare(block)) {
            return "";
        }

        let data = readBlock(block);
        stopCrypto();

        if (data.length != 18) {
            return "";
        }

        let result = "";

        for (let i = 0; i < 16; i++) {
            if (data[i] == 0) {
                break;
            }

            result += String.fromCharCode(data[i]);
        }

        return result;
    }

    /**
     * Zapisuje maksymalnie 16 znaków ASCII do bloku.
     * Uwaga: nadpisuje poprzednie dane.
     * @param text tekst do zapisania
     * @param block numer bloku pamięci
     */
    //% block="RC522 write text %text to block %block"
    //% block.min=1 block.max=62 block.defl=4
    //% weight=60
    export function writeText(text: string, block: number): boolean {
        if (!validBlock(block)) {
            return false;
        }

        if (text.length > 16) {
            return false;
        }

        if (!prepare(block)) {
            return false;
        }

        let data: number[] = [];

        for (let i = 0; i < 16; i++) {
            if (i < text.length) {
                let code = text.charCodeAt(i);

                if (code > 127) {
                    stopCrypto();
                    return false;
                }

                data.push(code);
            } else {
                data.push(0);
            }
        }

        let success = writeBlock(block, data);
        stopCrypto();

        return success;
    }

    /**
     * Informuje o wyniku ostatniego uwierzytelniania.
     */
    //% block="RC522 authentication OK"
    //% weight=50
    export function authenticationOK(): boolean {
        return authenticated;
    }
}
