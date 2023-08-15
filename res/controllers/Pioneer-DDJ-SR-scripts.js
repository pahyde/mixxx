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

    var currDeck = this;

    this.shiftButton = new components.Button({
        midi: [0x90 + midiChannel, 0x3F],
        type: 0,
        input: function(channel, control, value, status, group) {
            if (value > 0) {
                currDeck.shift();
            } else {
                currDeck.unshift();
            }
        }
    })

    this.tempoFader = new components.Pot({
        inKey: "rate",
        invert: true,
    });

    this.play = new components.PlayButton({
        midi: [0x90 + midiChannel, 0x0B],
        shiftOffset: 0x3C,
        shiftControl: true,
        sendShifted: true
    });

    this.cue = new components.CueButton({
        midi: [0x90 + midiChannel, 0x0C],
        shiftOffset: 0x3C,
        shiftControl: true,
        sendShifted: true
    });

    this.sync = new components.SyncButton({
        midi: [0x90 + midiChannel, 0x58],
        shiftOffset: 4,
        shiftControl: true,
        sendShifted: true,
    });
    
    this.load = new components.Button({
        midi: [0x96, 0x46 + midiChannel],
        inKey: 'LoadSelectedTrack'
    })

    this.keyLock = new components.Button({
        midi: [0x90 + midiChannel, 0x1A],
        key: 'keylock',
        type: components.Button.prototype.types.toggle
    })

    this.pfl = new components.Button({
        midi: [0x90 + midiChannel, 0x54],
        key: 'pfl',
    });

    this.pad = new DDJSR.pad(deckNumber, midiChannel);
    this.jogWheel = new DDJSR.jogWheel(deckNumber);

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
//                     Jog Wheel                         //
///////////////////////////////////////////////////////////

DDJSR.jogWheel = function(deckNumber) {

    return new components.JogWheelBasic({
        deck: deckNumber, 
        wheelResolution: 2048, 
        alpha: 1/8,
        inValueScale: function(value) {
            return (value - 0x40);
        },
        inputTouch: function(channel, control, value, status, _group) {
            if (this.isPress(channel, control, value, status) && this.vinylMode) {
                this.scratchEnable();
            } else {
                this.scratchDisable();
            }
        },
        inputWheel: function(_channel, _control, value, _status, _group) {
            value = this.inValueScale(value);
            if (engine.isScratching(this.deck)) {
                engine.scratchTick(this.deck, value);
            } else {
                this.inSetValue(value / 4);
            }
        },
        scratchEnable: function() {
            engine.scratchEnable(this.deck,
                this.wheelResolution,
                this.rpm,
                this.alpha,
                this.beta);
        },
        scratchDisable: function() {
            engine.scratchDisable(this.deck);
        }
    });
}


///////////////////////////////////////////////////////////
//                   Performance Pads                    //
///////////////////////////////////////////////////////////

DDJSR.padMode = {
    hotCue: 0,
    roll: 1,
    slicerCont: 2,
    slicerLoop: 3,
    sampler: 4,
}

DDJSR.looprollIntervals = [1/16, 1/8, 1/4, 1/2, 1, 2, 4, 8];

DDJSR.pad = function(deckNumber, midiChannel) {
    components.ComponentContainer.call(this, null);

    var padState = { 
        mode: DDJSR.padMode.hotCue 
    }

    this.setMode = function(channel, control, value, status, group) {
        if (value === 0) {
            // button release
            return;
        }
        switch (control) {
        // HOT CUE
        case 0x1B:
            padState.mode = DDJSR.padMode.hotCue;
            break;
        // ROLL
        case 0x1E:
            padState.mode = DDJSR.padMode.roll;
            break;
        // SLICER
        case 0x20:
            if (padState.mode == DDJSR.padMode.slicerCont) {
                padState.mode = DDJSR.padMode.slicerLoop;
            } else {
                padState.mode = DDJSR.padMode.slicerCont;
            }
            break;
        // SAMPLER
        case 0x22:
            padState.mode = DDJSR.padMode.sampler;
            break;
        }
    }

    this.hotcue = [];
    for (var i = 0; i < 8; i++) {
        this.hotcue[i] = new components.HotcueButton({
            midi: [0x90 + 7 + midiChannel, 0x00 + i],
            number: i+1,
        });
    }

    this.roll = [];
    for (var i = 0; i < 8; i++) {
        this.roll[i] = new components.Button({
            midi: [0x90 + 7 + midiChannel, 0x10 + i],
            number: i+1,
            key: 'beatlooproll_' + DDJSR.looprollIntervals[i] + '_activate',
            inSetValue: function(value) {
                engine.setValue(this.group, 'quantize', value);
                engine.setValue(this.group, this.inKey, value);
            },
        });
    }

    this.slicer = new DDJSR.Slicer(deckNumber, padState);

    this.reconnectComponents(function (c) {
        if (c.group === undefined) {
            c.group = deckNumberToGroup(deckNumber);
        }
    });
}

DDJSR.pad.prototype = components.ComponentContainer.prototype;

DDJSR.Slicer = function(deckNumber, padState) {
    var sliceIndex = 0;

    components.Component.call(this, {
        group: deckNumberToGroup(deckNumber),
        outKey: 'beat_active',
        output: function() {
            engine.log(sliceIndex++);
        }
    })

}

DDJSR.Slicer.prototype = components.Component.prototype;


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

function deckNumberToGroup(deckNumber) {
    return '[Channel' + deckNumber + ']';
}