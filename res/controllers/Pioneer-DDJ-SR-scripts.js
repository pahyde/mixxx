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
    slicer: 2,
    sampler: 3,
}

DDJSR.looprollIntervals = [1/16, 1/8, 1/4, 1/2, 1, 2, 4, 8];

DDJSR.pad = function(deckNumber, midiChannel) {
    components.ComponentContainer.call(this, null);

    var padState = { 
        mode: DDJSR.padMode.hotCue 
    }

    this.setMode = function(channel, control, value, status, group) {
        var isPress = value > 0;
        if (!isPress) {
            return;
        }
        if (control === 0x20) {
            // handle slicer start
            if (padState.mode === DDJSR.padMode.slicer) {
                this.slicer.modeToggle();
            } else {
                padState.mode = DDJSR.padMode.slicer;
                this.slicer.setContinuousMode();
                this.slicer.start();
            }
            return;
        }
        if (padState.mode === DDJSR.padMode.slicer) {
            this.slicer.stop();
        }
        if (control === 0x1B) {
            padState.mode = DDJSR.padMode.hotCue;
        } else if (control === 0x1E) {
            padState.mode = DDJSR.padMode.roll;
        } else if (control === 0x22) {
            padState.mode = DDJSR.padMode.sampler;
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


///////////////////////////////////////////////////////////
//                       Slicer                          //
///////////////////////////////////////////////////////////

DDJSR.slicerMode = {
    continuous: 0,
    loop: 1
}

DDJSR.Slicer = function(deckNumber, padState) {
    components.Component.call(this, {
        group: deckNumberToGroup(deckNumber),
        channel: deckNumber-1,
        mode: DDJSR.slicerMode.continuous,
        syncConnection: null,
        lookAheadMargin: 0,
        isRunning: false,
    });

    var slicer = this;

    this.modeToggle = function() {
        if (this.mode === DDJSR.slicerMode.loop) {
            this.setContinuousMode() 
        } else {
            this.setLoopMode();
        }
    }

    this.setContinuousMode = function() {
        this.mode = DDJSR.slicerMode.continuous;
        for (var i = 0; i < 8; i++) {
            this.setLED(i, 0);
        }
    }

    this.setLoopMode = function() {
        this.mode = DDJSR.slicerMode.loop;
        for (var i = 0; i < 8; i++) {
            this.setLED(i, 0x7F);
        }
    }

    this.trackConnection = engine.makeConnection(this.group, 'duration', function(position) {
        if (slicer.isRunning) {
            slicer.stop();
        }
    });

    this.playConnection = engine.makeConnection(this.group, 'play', function(position) {
        if (padState.mode === DDJSR.padMode.slicer && !slicer.isRunning) {
            slicer.start();
        }
    });

    this.sampledBeat = null;
    this.buttonInput = function(channel, control, value, status, group) {
        if (value === 0) {
            // button release
            return;
        }
        this.sampledBeat = control - 0x20;
        engine.log(this.sampledBeat);
    }

    this.start = function() {
        this.isRunning = true;

        var sliceStartPos = this.getSlicePositionClosest()
        var positionPerBeat = this.getPositionPerBeat();

        var currPos = engine.getValue(this.group, 'playposition');
        var sliceIndex = currPos < sliceStartPos ? -2 : -1;
        var activeBeat = sliceIndex;

        var beatUpdate = false;
        var loopOn = false;
        engine.setValue(this.group, 'quantize', true);
        engine.setValue(this.group, 'beatloop_size', 1);

        /*
        state varables:
            - sliceStartPos: start position of the slice loop
            - sliceIndex: 0 - 7
            - activeBeat: the state of the current playing beat maintained by the slicer (relative to start position)
            - trackBeat: the actual current beat playing in the track (relative to start position)
            - this.sampledBeat: the user input beat to jump to
        */
        this.syncConnection = engine.makeConnection(this.group, 'playposition', function(position) {
            var posOffset = position - sliceStartPos;
            var trackBeatFloat = posOffset / positionPerBeat + this.lookAheadMargin;
            var trackBeat = Math.floor(trackBeatFloat);
            var trackBeatProgress = trackBeatFloat - trackBeat
            if (beatUpdate && trackBeatProgress > 1/32) {
                // set temporary loop as a visual cue
                engine.setValue(this.group, 'beatloop_activate', true);
                beatUpdate = false;
                loopOn = true;
            } else if (loopOn) {
                // loops only serve as a visual cue
                // immediately exit any loops
                this.loopExit();
                loopOn = false;
            }
            if (trackBeat === activeBeat) {
                // same beat, no change
                return;
            }
            // new beat occurred
            // move to user input sampledBeat if non-null, otherwise next sliceIndex
            beatUpdate = true;
            sliceIndex++;
            if (sliceIndex === 8) {
                sliceIndex -= 8
                if (this.mode === DDJSR.slicerMode.continuous) {
                    sliceStartPos += 8 * positionPerBeat;
                    activeBeat -= 8
                    trackBeat -= 8
                    // Note: sampledBeat gets rolled forward with start position. no update.
                }
            }

            var userInputConsumed = false;
            var nextActiveBeat = (function(sampledBeat, sliceIndex) {
                if (sliceIndex < 0) {
                    return sliceIndex;
                }
                if (sampledBeat !== null) {
                    userInputConsumed = true;
                    return sampledBeat
                }
                return sliceIndex;
            })(this.sampledBeat, sliceIndex);

            if (userInputConsumed) {
                // sampledBeat occurred. clear for next slice
                this.sampledBeat = null;
            }

            if (nextActiveBeat !== trackBeat) {
                this.jumpBeats(nextActiveBeat - trackBeat)
            }

            var activeLED = activeBeat < 0 ? activeBeat + 8 : activeBeat;
            var nextActiveLED = nextActiveBeat;
            this.setLED(slicer.channel, activeLED, this.mode === DDJSR.slicerMode.continuous ? 0 : 0x7F);
            this.setLED(slicer.channel, nextActiveLED, this.mode === DDJSR.slicerMode.continuous ? 0x7F : 0);
            activeBeat = nextActiveBeat;
        });
    }

    this.stop = function() {
        this.isRunning = false;
        this.syncConnection.disconnect();
        this.loopExit();
        engine.setValue(this.group, 'quantize', false);
        engine.log(this.group)
        //engine.setValue(this.group, "reloop_toggle", true);
        //engine.setValue(this.group, 'beatloop_activate', false);
    }

    this.setLED = function(channel, index, value) {
        midi.sendShortMsg(0x97 + channel, 0x20 + index, value);
    }

    this.jumpBeats = function(offset) {
        engine.setValue(this.group, 'beatjump', offset);
    }

    this.getSlicePositionClosest = function() {
        var closestSample = engine.getValue(this.group, 'beat_closest');
        var totalSamples = engine.getValue(this.group, 'track_samples');
        return closestSample / totalSamples;
    }

    this.getPositionPerBeat = function() {
        var secondsPerBeat = 1 / (engine.getValue(this.group, 'bpm') / 60);
        var secondsPerTrack = engine.getValue(this.group, 'duration');
        return secondsPerBeat / secondsPerTrack;
    }

    this.loopExit = function() {
        if (engine.getValue(this.group, "loop_enabled")) {
            engine.setValue(this.group, "reloop_toggle", true);
        }
    }
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