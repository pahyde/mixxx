/*
 * MIDI script for the Pioneer DDJ-SR controller
*/

var DDJSR = {};


DDJSR.init = function (id, debugging) {
    //initialize decks
    DDJSR.deck = [];
    for (var i = 0; i < 4; i++) {
        DDJSR.deck.push(new DDJSR.Deck(i+1, i));
    }

}

DDJSR.Deck = function(deckNumber, midiChannel) {
    components.Deck.call(this, deckNumber);
    this.play = new components.PlayButton([0x90 + midiChannel, 0x0B]);
    this.cue = new components.CueButton([0x90 + midiChannel, 0x0C]);
    this.sync = new components.SyncButton([0x90 + midiChannel, 0x58]);
    this.pfl = new components.Button({
        midi: [0x90 + midiChannel, 0x54],
        key: 'pfl',
    });
    this.hotcue = [];
    for (var i = 1; i <= 8; i++) {
        this.hotcue[i] = new components.HotcueButton({
            midi: [0x90 + 8 + midiChannel, 0x00 + i],
            number: i,
        });
    }

    this.reconnectComponents(function (c) {
        if (c.group === undefined) {
            // 'this' inside a function passed to reconnectComponents refers to the ComponentContainer
            // so 'this' refers to the custom Deck object being constructed
            c.group = this.currentDeck;
        }
    });
}

DDJSR.Deck.prototype = new components.Deck();


///////////////////////////////////////////////////////////
//                    ROTARY SELECTOR                    //
///////////////////////////////////////////////////////////

DDJSR.rotarySelector = new components.Encoder({
    onKnobEvent: function(value) {
        var delta = value & 0x40 ? value - 0x80 : value;
        engine.setValue("[Library]", "MoveVertical", delta);
    },
    onButtonEvent: function() {
        script.toggleControl("[Library]", "MoveFocusForward");
    },
    input: function(channel, control, value, status) {
        switch (status) {
        case 0xB6: // Rotate.
            this.onKnobEvent(value);
            break;
        case 0x96: // Push.
            this.onButtonEvent();
            break;
        default:
            throw Error('Undefined status code for rotarySelector');
        }
    }
})

DDJSR.shutdown = function() {
    for (var i = 1; i <= 2048; i++) { 
        //midi.sendShortMsg(0x90, i, 0x00);
        //midi.sendShortMsg(0x91, i, 0x00);
    }

}
