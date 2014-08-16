const {Cc, Ci, Cu, components} = require('chrome');
const selfId = 'jid0-WorkspaceHopper';
const selfTitle = 'workspacehopper';
const selfPath = 'resource://' + selfId + '-at-jetpack/' + selfTitle + '/'; //NOTE - this must be gotten from "Properties" panel //example: selfPath + 'data/style/global.css'

Cu.import('resource://gre/modules/Services.jsm');
const wm = Services.wm; //Cc['@mozilla.org/appshell/window-mediator;1'].getService(Ci.nsIWindowMediator);
const as = Cc['@mozilla.org/alerts-service;1'].getService(Ci.nsIAlertsService);
const obs = Services.obs; //Cc['@mozilla.org/observer-service;1'].getService(Ci.nsIObserverService);
const ps = Services.prefs; //Cc['@mozilla.org/preferences-service;1'].getService(Ci.nsIPrefBranch);

var wtHistory = []; //holds array of arrays, each subarray is [window, tab], if tab is null then means window has no gBrowser
var time_keyDowned = {};
var time_keyUpped = {};
var heldTimer = {};
var dblHeldTimer = {};
var time_keyDblDowned = {};
var time_keyDblUpped = {};
var heldJustFired = {}; //key is keyCode and after first upped after held it will remove from here //used for both held and dblHeld
var downFireOnceHack = {}; //see heldJustFired but this is the hack so to hack around the fact that keydown fires multiple times, this is not a problem with ff, just try it, press a key and hold it you will see it types that letter over and over
const prefPrefix = 'extensions.' + selfId + '@jetpack.'; //for the pref stuff //jetpack stuff has @jetpack appended //note must have period at end because when do branch.set if no period then there is no period between prefix and the set name, likewise for get

//var iOptsDoc; //doc_lastUsedByInlineOpts; //updated whenever the obs of inlineoptsdispd fires and stores the doc, this is needed because on pref change of hotkey, the label must be adjusted accordingly
var addonMgrXulWin = null;
var timeoutWaitToSeeIfUserWantsToDblHit;

var settingKey = null;
var localize_NoKeySet = 'No Key Set'; //n1
var localize_HotkeyRemoved = 'Prior hotkey was removed. ';
var localize_Listening = 'Listening... ';
var localize_ListeningExitMsg = '(Press new hotkey(s) or click anywhere to cancel)';
var localize_template_KeyLbl = {
    downed: 'Press "{LOC}{KEY}"',
    upped: 'Release "{LOC}{KEY}"',
	held: 'Hold "{LOC}{KEY}"',
	dblDowned: 'Press "{LOC}{KEY}" Twice',
	dblUpped: 'Release "{LOC}{KEY}" Twice',
	dblHeld: 'Press twice and hold "{LOC}{KEY}"'
};
var observers = {
	inlineOptsDispd: {
		observe:	function(aSubject, aTopic, aData) {
						notify('incoming inlineOptsDispd: aSubject = ' + aSubject + ' | aTopic = ' + aTopic + ' | aData = ' + aData);
						if (aTopic == 'addon-options-displayed' && aData == selfId + '@jetpack') {
							var doc = aSubject;
							//iOptsDoc = doc; //commented out on 113013 as now using addonMgrXulWin.window.document
							addonMgrXulWin = addonMgr();
							//addonMgrXulWin.window.document == doc == aSubject == iOptsDoc
							//wm.getMostRecentWindow('navigator:browser').noit = [addonMgrXulWin, doc]; //113013 tets to figure out what to replace iOptsDoc with
							//notify('doc == addonMgrXulWin.domWindow.contentDocument: ' + doc == addonMgrXulWin.domWindow.contentDocument); //113013 tets to figure out what to replace iOptsDoc with
							
							//start formatting
							var settings = doc.querySelectorAll('setting[type=integer]');
							[].forEach.call(settings, function(s) {
								var aTextbox = doc.getAnonymousElementByAttribute(s, 'anonid', 'input')
								aTextbox.setAttribute('flex', 0); //do this cuz the current flex attribute is 1, ask why i cant override this with css -moz-box-flex:0
								aTextbox.setAttribute('size', 6);
								aTextbox.setAttribute('increment', 50);
								var aHbox = aTextbox.parentNode;
								aHbox.setAttribute('style', '-moz-box-pack:end'); //or can set aHbox.pack = 'end'
							});

							var settings = doc.querySelectorAll('setting[type=control]');
							[].forEach.call(settings, function(s) {
								var aNodes = doc.getAnonymousNodes(s);
								var aHbox = aNodes[aNodes.length-1]; //by domInsp i know the last hbox child of settings is the hbox i want to target
								aHbox.setAttribute('style', '-moz-box-pack:end');
							});
							//end formatting
							
							//insert labels for hotkeys
							for (var h in prefs) {
								if (h.indexOf('hotkey_') != 0) {
									continue;
								}
								var props = {
									id: 'label_' + h,
									style: 'padding: 0 5px 2px 5px;'
								};
								var preExEl = doc.querySelector('#' + props.id);
								if (preExEl) { //label is already there so continue, so remove it then we'll add again
									preExEl.parentNode.removeChild(preExEl);
								}
								var el = doc.createElement('label');
								for (var p in props) {
									el.setAttribute(p, props[p]);
								}
								var btn = doc.querySelector('button[pref-name=' + h + ']');
								btn.parentNode.insertBefore(el, btn);
								updateSetKeyLbl(h);
							}
							//end insert labels
						}
					},
		reg:	function() {
				obs.addObserver(observers.inlineOptsDispd, 'addon-options-displayed', false);
			},
		unreg:	function() {
				obs.removeObserver(observers.inlineOptsDispd, 'addon-options-displayed');
			}
	},
	inlineOptsHid: {
		observe:	function(aSubject, aTopic, aData) {
						notify('incoming inlineOptsHid: aSubject = ' + aSubject + ' | aTopic = ' + aTopic + ' | aData = ' + aData);
						if (aTopic == 'addon-options-hidden' && aData == selfId + '@jetpack') {
							addonMgrXulWin = null; //trial as of 112713
						}
					},
		reg:	function() {
				obs.addObserver(observers.inlineOptsHid, 'addon-options-hidden', false);
			},
		unreg:	function() {
				obs.removeObserver(observers.inlineOptsHid, 'addon-options-hidden');
			}
	},
	optCtrlClikd: {
		observe:	function (aSubject, aTopic, aData) {
						notify('incoming optCtrlClikd: aSubject = ' + aSubject + ' | aTopic = ' + aTopic + ' | aData = ' + aData);
						//incoming observe == null | jid0-WorkspaceHopper@jetpack-cmdPressed | hotkey_hopTabCurWin
						settingKey = aData;
						//var am = addonMgr();
						//addonMgrXulWin = am.xulWindow;						
						addonMgrXulWin.xulWindow.addEventListener('mousedown', mouseDowned, true);
						addonMgrXulWin.xulWindow.addEventListener('mouseup', prevDefault, true);
						addonMgrXulWin.xulWindow.addEventListener('click', prevDefault, true);
						addonMgrXulWin.xulWindow.addEventListener('keypress', prevDefault, true);
						
						hotkeySetObj = {keycode:0,action:''};
						
						var btn = addonMgrXulWin.window.document.querySelector('button[pref-name=' + settingKey + ']');
						btn.setAttribute('style', 'display:none;');
						var lbl = addonMgrXulWin.window.document.querySelector('#label_' + settingKey);
						if (lbl.value == localize_NoKeySet) { //can alternatively check prefs.value.keycode == 0 (meaning no key set)
							lbl.value = localize_Listening + localize_ListeningExitMsg;
						} else {							
							prefs[settingKey].setval(settingKey, {keycode:0, action:'', mods:[]}); //myPrefListener._branch['set' + prefs[settingKey].type + 'Pref'](settingKey, JSON.stringify(prefs[settingKey].value));
							lbl.style.fontStyle = 'italic';
							lbl.value = localize_Listening + localize_HotkeyRemoved + localize_ListeningExitMsg;
						}
					},
		reg:	function() {
					obs.addObserver(observers.optCtrlClikd, selfId + '@jetpack-cmdPressed', false);
				},
		unreg:	function() {
					obs.removeObserver(observers.optCtrlClikd, selfId + '@jetpack-cmdPressed');
				}
	}
};

////start pref listener stuff
//edit prefs objection ONLY
//all pref paths are preceded with: 'extensions.' + selfTitle + '.
var prefs = { //each key here must match the exact name the pref is saved in the about:config database (without the prefix)
    hotkey_hopTabCurWin: {
			default: '{"keycode":19,"action":"upped","mods":[]}',
			value: null, //the current value, initialize on addon statup NEVER SET VALUE PROGRAMATICALLY, IF NEED TO SET VALUE THEN USE THE prefs[name].setval function, this is because onChange callback I use .value to figure out oldVal. setval func is like setting the pref in about:config, if json pref then must supply object
			type: 'Char', //call later on by going ps.['get' + pefs.blah.type + 'Pref'](prefs.blah.value) AND OR ps.['set' + pefs.blah.type + 'Pref'](prefs.blah.value)
			json: null, //if json is true then JSON.parse'ed when value is set, it should hold the non-parsed version of value (this saves the callback from running a JSON.stringify when figuring out oldValue
			onChange: hotkeyPref_onChange//this is additonal stuff you want to happen when pref observer finds it changes, by default on observe prefs.blah.value is matched to the new value, THIS SHOULD ALSO EXEC ON INIT(/ADDON STARTUP)		//so in all observers, whenever a pref is changed, it will set the prefs.blah.value to new value. onPreChange fires before prefs.blah.value is matched to new val		//onChange fires after value is matched to new val
		},
	hotkey_hopGlobal: {
			default: '{"keycode":19,"action":"held","mods":[]}',
			value: null,
			type: 'Char',
			json: null,
			onChange: hotkeyPref_onChange
		},
	hotkey_hopWin: {	
			default: '{"keycode":0,"action":"","mods":[]}',
			value: null,
			type: 'Char',
			json: null,
			onChange: hotkeyPref_onChange
		},
	holdTime: {
			default: 300,
			value: null,
			type: 'Int'
		},
	dblSpeed: {
			default: 300,
			value: null,
			type: 'Int'
		}
};
function prefSetval(name, updateTo) {
	if ('json' in prefs[name]) {
		//updateTo must be an object
		if (Object.prototype.toString.call(updateTo) != '[object Object]') {
			notify('EXCEPTION: prefs[name] is json but updateTo supplied is not an object');
			return;
		}
		
		var stringify = JSON.stringify(updateTo); //uneval(updateTo);
		myPrefListener._branch['set' + prefs[name].type + 'Pref'](name, stringify);
		//prefs[name].value = {};
		//for (var p in updateTo) {
		//	prefs[name].value[p] = updateTo[p];
		//}
	} else {
		//prefs[name].value = updateTo;
		myPrefListener._branch['set' + prefs[name].type + 'Pref'](name, updateTo);
	}
}
///pref listener generic stuff NO NEED TO EDIT
/**
 * @constructor
 *
 * @param {string} branch_name
 * @param {Function} callback must have the following arguments:
 *   branch, pref_leaf_name
 */
function PrefListener(branch_name, callback) {
  // Keeping a reference to the observed preference branch or it will get
  // garbage collected.
  this._branch = ps.getBranch(branch_name);
  this._defaultBranch = ps.getDefaultBranch(branch_name);
  this._branch.QueryInterface(Ci.nsIPrefBranch2);
  this._callback = callback;
}

PrefListener.prototype.observe = function(subject, topic, data) {
  if (topic == 'nsPref:changed')
    this._callback(this._branch, data);
};

/**
 * @param {boolean=} trigger if true triggers the registered function
 *   on registration, that is, when this method is called.
 */
PrefListener.prototype.register = function(trigger) {
	//adds the observer to all prefs and gives it the seval function
	this._branch.addObserver('', this, false);
	for (var p in prefs) {
		prefs[p].setval = prefSetval;
	}
	if (trigger) {
		this.forceCallbacks();
	}
};

PrefListener.prototype.forceCallbacks = function() {
	notify('forcing pref callbacks');
    let that = this;
    this._branch.getChildList('', {}).
      forEach(function (pref_leaf_name)
        { that._callback(that._branch, pref_leaf_name); });
};

PrefListener.prototype.setDefaults = function() {
	//sets defaults on the prefs in prefs obj
	notify('setDefaults');
	for (var p in prefs) {
		this._defaultBranch['set' + prefs[p].type + 'Pref'](p, prefs[p].default);
	}
};

PrefListener.prototype.unregister = function() {
  if (this._branch)
    this._branch.removeObserver('', this);
};

var myPrefListener = new PrefListener(prefPrefix, function (branch, name) {
	//extensions.myextension[name] was changed
	notify('callback start for pref: "' + name + '"');
	if (!(name in prefs)) {
		return; //added this because apparently some pref named prefPreix + '.sdk.console.logLevel' gets created when testing with builder
	}

	var refObj = {name: name}; //passed to onPreChange and onChange
	var oldVal = 'json' in prefs[name] ? prefs[name].json : prefs[name].value;
	try {
		var newVal = myPrefListener._branch['get' + prefs[name].type + 'Pref'](name);
	} catch (ex) {
		notify('exception when getting newVal (likely the pref was removed): ' + ex);
		var newVal = null; //note: if ex thrown then pref was removed (likely probably)
	}

	prefs[name].value = newVal === null ? prefs[name].default : newVal;

	if ('json' in prefs[name]) {
		refObj.oldValStr = oldVal;
		oldVal = JSON.parse(oldVal); //function(){ return eval('(' + oldVal + ')') }();

		refObj.newValStr = prefs[name].value;
		prefs[name].json = prefs[name].value;
		prefs[name].value =  JSON.parse(prefs[name].value); //function(){ return eval('(' + prefs[name].value + ')') }();
	}

	if (prefs[name].onChange) {
		prefs[name].onChange(oldVal, prefs[name].value, refObj);
	}
	notify('myPrefCallback done');
});
////end pref listener stuff
//end pref stuff

function hotkeyPref_onChange(oldVal, newVal, refObj) {
	notify(uneval(refObj)); //notify(JSON.stringify(refObj));
	updateSetKeyLbl(refObj.name);
	if (oldVal !== null) { //is null on startup callback or if removed
		//need to delete the oldVal_keycode from action obj
		if (action[oldVal.keycode]) {
			if (action[oldVal.keycode][oldVal.action]) {
				delete action[oldVal.keycode][oldVal.action];
			}
			if (Object.keys(action[oldVal.keycode]).length == 0) {
				delete action[oldVal.keycode];
			}
		}
	}

	if (newVal.keycode > 0) {
		notify('set action ' + newVal.keycode + ' ' + newVal.action);
		if (!action[newVal.keycode]) {
			action[newVal.keycode] = {};
		}
		if (refObj.name == 'hotkey_hopTabCurWin') {
			action[newVal.keycode][newVal.action] = function(e, window) { jumpTab(window); }
		} else if (refObj.name == 'hotkey_hopGlobal') {
			action[newVal.keycode][newVal.action] = function(e, window) { jumpGlobal(window); }
		} else if (refObj.name == 'hotkey_hopWin') {
			action[newVal.keycode][newVal.action] = function(e, window) { jumpWindow(window); }
		} else {
			notify('SHOULD NEVER GET HERE');
		}
		notify('ACTION OBJ = = = = ' + uneval(action));
	}
}

function updateSetKeyLbl(which) { //n1
	//which should be like 'hotkey_hopWin'
	//reads the pref value and updates the label
	//var btn = addonMgrXulWin.window.document.querySelector('button[pref-name=' + which + ']');

	if (!addonMgrXulWin || !addonMgrXulWin.window || !addonMgrXulWin.window.document) {
		notify('addonMgrXulWin.window.document DNE so return');
		return;
	}
	var lbl = addonMgrXulWin.window.document.querySelector('#label_' + which);
	if (lbl) {
		if (settingKey === null) {
			if (prefs[which].value.keycode == 0) {
				if (lbl.value.indexOf(localize_Listening) == -1) {
					lbl.style.fontStyle = 'italic';
					lbl.value = localize_NoKeySet;
				} else {
					//do nothing
				}
			} else {
				var strLocAndKey = strLocAndKeyOfKeyCode(prefs[which].value.keycode);
				lbl.style.fontStyle = 'normal';
				//lbl.value = 'KeyCode: ' + prefs[which].value.keycode + ' Action: ' + prefs[which].value.action;
				//Cu.reportError(which + '  prefs[which].value.action = "' + prefs[which].value.action + '"');
				lbl.value = localize_template_KeyLbl[prefs[which].value.action].replace('{LOC}', strLocAndKey.loc).replace('{KEY}', strLocAndKey.key);
			}
		} else {
			//lbl.value = localize_Listening + 'KeyCode: ' + hotkeySetObj.keycode +' Action: ' + hotkeySetObj.action;
			if (prefs[which].value.keycode == 0) {
				//do nothing
			} else {
				//Cu.reportError(which + '  IS NOT null hotkeySetObj.action = "' + hotkeySetObj.action + '"');
				var strLocAndKey = strLocAndKeyOfKeyCode(hotkeySetObj.keycode);
				lbl.value = localize_Listening + localize_template_KeyLbl[hotkeySetObj.action].replace('{LOC}', strLocAndKey.loc).replace('{KEY}', strLocAndKey.key);
			}
		}
	}
}

var keycodeToStr = {3:'Cancel',6:'Help',8:'Backspace',9:'Tab',12:{other:'5 (While NumLock Off)', Darwin:'Clear'},13:'Return/Enter',14:'Enter "Unused"',16:'Shift',17:'Control',18:{other:'Alt', Darwin: 'Option'},19:'Pause',20:'Caps Lock',21:'Kana or Hangul',22:'Eisu',23:'Junja',24:'Final',25:'Hanja or Kanji',27:'Esc',28:'Convert',29:'Non-Convert',30:'Accept',31:'Mode Change',32:'Space Bar',33:'Page Up',34:'Page Down',35:'End',36:'Home',37:'Left Arrow',38:'Up Arrow',39:'Right Arrow',40:'Down Arrow',41:'Select',42:'Print',43:'Execute',44:'Print Screen',45:'Ins(ert)',46:'Del(ete)',48:'0',49:'1',50:'2',51:'3',52:'4',53:'5',54:'6',55:'7',56:'8',57:'9',58:':',59:';',60:'<',61:'=',62:'>',63:'?',64:'@',65:'A',66:'B',67:'C',68:'D',69:'E',70:'F',71:'G',72:'H',73:'I',74:'J',75:'K',76:'L',77:'M',78:'N',79:'O',80:'P',81:'Q',82:'R',83:'S',84:'T',85:'U',86:'V',87:'W',88:'X',89:'Y',90:'Z',91:{other:'undefined',WINNT:'Win Logo',Linux:'Super/Hyper'},93:'Context Menu',95:'Sleep',96:'0',97:'1',98:'2',99:'3',100:'4',101:'5',102:'6',103:'7',104:'8',105:'9',106:'*',107:'+',108:'Separator',109:'-',110:'.',111:'/',112:'F1',113:'F2',114:'F3',115:'F4',116:'F5',117:'F6',118:'F7',119:'F8',120:'F9',121:'F10',122:'F11',123:'F12',124:'F13',125:'F14',126:'F15',127:'F16',128:'F17',129:'F18',130:'F19',131:'F20',132:'F21',133:'F22',134:'F23',135:'F24',144:'NumLock',145:'Scroll Lock',146:'Dictionary',147:'Unregister Word',148:'Register Word',149:'Left OYAYUBI',150:'Right OYAYUBI',160:'^',161:'!',162:'"',163:'#',164:'$',165:'%',166:'&',167:'_',168:'(',169:')',170:'*',171:'+',172:'|',173:'-',174:'{',175:'}',176:'~',181:'Volume Mute',182:'Volume Down',183:'Volume Up',188:',',190:'.',191:'/',192:'`',219:'[',220:'\\',221:']',222:'\'',224:{other:'undefined',Linux:'Meta',Darwin:'Command'},225:'AltGr',227:'Help',228:'0',230:'Clear',233:'Reset',234:'Jump',235:'PA1',236:'PA2',237:'PA3',238:'WS Control',239:'CuSel',240:'Attn',241:'Finish',242:'Copy',243:'Auto',244:'ENLW',245:'Back Tab',246:'Attn',247:'CrSel (Cursor Selection)',248:'ExSel (Extend Selection)',249:'Erase EOF',250:'Play',251:'Zoom',253:'PA1',254:'Clear'};
function strLocAndKeyOfKeyCode(eKeyCode) {
	var strObj = {key: null, loc: null}; //this is the return value
	
	if (eKeyCode >= 10000) {
		var kLoc = (eKeyCode + '').substr(0,1);
	} else {
		var kLoc = 0;
	}
	var kKeyCode = eKeyCode - (kLoc * 10000);
	
	strObj.key = keycodeToStr[kKeyCode];
	if (Object.prototype.toString.call(strObj.key) == '[object Object]') {
		var os = Services.appinfo.OS;
		if (strObj.key[os]) {
			strObj.key = strObj.key[os];
		} else {
			strObj.key = strObj.key.other;
		}
	}
	
	notify('kloc = "' + kLoc + '"');
	
	switch (kLoc) {
		case '1':
			strObj.loc = 'Left ';
			break;
		case '2':
			strObj.loc = 'Right ';
			break;
		case '3':
			strObj.loc = 'Numpad ';
			break;
		default:
			strObj.loc = '';
	}
	return strObj;
}

var hotkeySetObj = {keycode:0,action:''};
function keyDownedListener(e, window) {
	var eKeyCode = e.keyCode + (10000 * e.location);
	if (settingKey !== null) {
		e.returnValue = false;
		e.preventDefault();
		e.stopPropagation();
	}
    var now = new Date();
	
    if (!action[eKeyCode] && settingKey === null) { return } //added for efficiency, so if no action for this key then why go thru the rest
    
    if (!downFireOnceHack[eKeyCode] && time_keyDowned[eKeyCode] && now.getTime() - time_keyDowned[eKeyCode].getTime() <= prefs.dblSpeed.value) {
        downFireOnceHack[eKeyCode] = 1;
        time_keyDblDowned[eKeyCode] = now;
        dblHeldTimer[eKeyCode] = window.setTimeout(function(){ keyDblHeld(e, window) }, prefs.holdTime.value);
        //notify('keyDblDowned: keyCode = ' + e.keyCode + ' eKeyCode = ' + eKeyCode);
		keyDblDowned(e, window); //n1
    } else {
        if (!downFireOnceHack[eKeyCode]) { //this is hack to get around the multi send of keydown
            downFireOnceHack[eKeyCode] = 1;
            time_keyDowned[eKeyCode] = now;
            heldTimer[eKeyCode] = window.setTimeout(function(){ keyHeld(e, window) }, prefs.holdTime.value);
            //notify('keyDowned: keyCode = ' + e.keyCode + ' eKeyCode = ' + eKeyCode);
            //do keyDowned stuff here, because if its DblDowned stuff we do DblDowned stuff and not singleDowned stuff
			keyDowned(e, window);
        }
    }
}

function keyUppedListener(e, window) {
	var eKeyCode = e.keyCode + (10000 * e.location);
    var now = new Date();
	try { delete downFireOnceHack[eKeyCode]; } catch(ex) { notify('ex on deleting downFireOnceHack:' + ex); } //had to put this here because if click "set key" then click to cancel so it sets key for "downed" then on up setting === null so it doesnt get past the  'if (!action[eKeyCode] && settingKey === null) { return }' so downFireOnceHack[eKeyCode] is never deleted
	
    if (!action[eKeyCode] && settingKey === null) { return } //added for efficiency, so if no action for this key then why go thru the rest
    
    if (heldTimer[eKeyCode]) { //added if because if it fired then it was already deleted
        window.clearTimeout(heldTimer[eKeyCode]);
        delete heldTimer[eKeyCode];
    }
    if (dblHeldTimer[eKeyCode]) { //if needed for see heldTimer reason but ALSO if never did dblDown the dblHeldTimer never set up
        window.clearTimeout(dblHeldTimer[eKeyCode]);
        delete dblHeldTimer[eKeyCode];
    }
    
    delete downFireOnceHack[eKeyCode]; //this is the hack to get around multi keydown send
    
    if (time_keyUpped[eKeyCode] && now.getTime() - time_keyUpped[eKeyCode].getTime() <= prefs.dblSpeed.value) {
        time_keyDblUpped[eKeyCode] = now;
        //notify('keyDblUpped: keyCode = ' + e.keyCode + ' eKeyCode = ' + eKeyCode);
		keyDblUpped(e, window);
    } else {
        if (heldJustFired[eKeyCode]) { //testing if held was fired
            delete heldJustFired[eKeyCode]; //remove keyCode from heldJustFired obj
        } else {
            time_keyUpped[eKeyCode] = now;
            //notify('keyUpped: keyCode = ' + e.keyCode + ' eKeyCode = ' + eKeyCode);
            keyUpped(e, window);
            //do keyUpped stuff here, because if its DblUpped stuff we do DblUpped stuff and not singleUpped stuff
        }
    }
}

function keyHeld(e, window) {
	var eKeyCode = e.keyCode + (10000 * e.location);
    //meaning key was downed for prefs.holdTime.value
    notify('keyHeld: keyCode = ' + e.keyCode + ' eKeyCode = ' + eKeyCode);
    heldJustFired[eKeyCode] = true;
    delete heldTimer[eKeyCode];
	if (settingKey !== null) {
		notify('keyHeld  in set');
		hotkeySetObj.action = 'held';
		updateSetKeyLbl(settingKey);
		exitInSet();
		return;
	}
    if (action[eKeyCode] && action[eKeyCode].held) {
        action[eKeyCode].held(e, window);
    }
}

function keyDblHeld(e, window) {
	var eKeyCode = e.keyCode + (10000 * e.location);
    //meaning key was downed for prefs.holdTime.value after dblDowned
    notify('keyDblHeld: keyCode = ' + e.keyCode + ' eKeyCode = ' + eKeyCode);
    heldJustFired[eKeyCode] = true;
    delete dblHeldTimer[eKeyCode];
	if (settingKey !== null) {
		notify('keyDblHeld in set');
		hotkeySetObj.action = 'dblHeld';
		updateSetKeyLbl(settingKey);
		exitInSet();
		return;
	}
    if (action[eKeyCode] && action[eKeyCode].dblHeld) {
        action[eKeyCode].dblHeld(e, window);
    }
}

function keyDblDowned(e, window) {
	var eKeyCode = e.keyCode + (10000 * e.location);
    notify('keyDblDowned: keyCode = ' + e.keyCode + ' eKeyCode = ' + eKeyCode);
	if (settingKey !== null) {
		addonMgrXulWin.xulWindow.clearTimeout(timeoutWaitToSeeIfUserWantsToDblHit);
		notify('keyDblDowned in set');
		hotkeySetObj.action = 'dblDowned';
		updateSetKeyLbl(settingKey);
		return;
	}
	if (action[eKeyCode] && action[eKeyCode].dblDowned) {
		action[eKeyCode].dblDowned(e, window);
	}
}

function keyDblUpped(e, window) {
	var eKeyCode = e.keyCode + (10000 * e.location);
    notify('keyDblUpped: keyCode = ' + e.keyCode + ' eKeyCode = ' + eKeyCode);
	if (settingKey !== null) {
		notify('keyDblUpped in set');
		hotkeySetObj.action = 'dblUpped';
		updateSetKeyLbl(settingKey);
		exitInSet();
		return;
	}
	if (action[eKeyCode] && action[eKeyCode].dblUpped) {
		action[eKeyCode].dblUpped(e, window);
	}
}

function keyDowned(e, window) {
	var eKeyCode = e.keyCode + (10000 * e.location);
    notify('keyDowned: keyCode = ' + e.keyCode + ' eKeyCode = ' + eKeyCode);
	if (settingKey !== null) {
		notify('keyDowned in set');
		if (hotkeySetObj.keycode == 0) {
			hotkeySetObj.keycode = eKeyCode;
			hotkeySetObj.action = 'downed';
			updateSetKeyLbl(settingKey);
		}
		return;
	}
	if (action[eKeyCode] && action[eKeyCode].downed) {
		action[eKeyCode].downed(e, window);
	}
}

function keyUpped(e, window) {
	var eKeyCode = e.keyCode + (10000 * e.location);
    notify('keyUpped: keyCode = ' + e.keyCode + ' eKeyCode = ' + eKeyCode);
	if (settingKey !== null) {
		notify('keyUpped in set');
		if (hotkeySetObj.keycode == eKeyCode) {
			//exit setting
			timeoutWaitToSeeIfUserWantsToDblHit = addonMgrXulWin.xulWindow.setTimeout(function(){exitInSet()}, prefs.dblSpeed.value);
			hotkeySetObj.action = 'upped';
			updateSetKeyLbl(settingKey);
		}
		return;
	}
	if (action[eKeyCode] && action[eKeyCode].upped) {
			action[eKeyCode].upped(e, window);
		}
}

function prevDefault(e) {
	notify('key pressed');
	e.returnValue = false;
	e.preventDefault();
	e.stopPropagation();
	return false;
}

function removeSetEvents() {
	//have to settimeout because in click event fires after mouseup, and listenrs get removed in mouseup, but have to use mouseup because if user mousedowned and moved mouse somewhere else then let go, click event never fires
	addonMgrXulWin.xulWindow.setTimeout(function(){
		addonMgrXulWin.xulWindow.removeEventListener('mousedown', mouseDowned, true);
		addonMgrXulWin.xulWindow.removeEventListener('mouseup', prevDefault, true);
		addonMgrXulWin.xulWindow.removeEventListener('click', prevDefault, true);
		addonMgrXulWin.xulWindow.removeEventListener('keypress', prevDefault, true);
	}, 100); // i just arbitrarily picked 100ms, im just guessing that the click event is fired within 100ms after mouseup (if click event is to be fired)
	
	addonMgrXulWin.xulWindow.removeEventListener('mouseup', removeSetEvents, true);
}

function exitInSet(fromMousedown) {

	if (fromMousedown) {
		addonMgrXulWin.xulWindow.addEventListener('mouseup', removeSetEvents, true);
	} else {
		removeSetEvents();
		/* THINK ABOUT THIS BLOCK: NOTE: NOIT 120413
		addonMgrXulWin.xulWindow.setTimeout(function(){
			removeSetEvents();
		}, prefs.dblSpeed.value); // allow at least the dblSpeed before removing, because after keyup still listening for dblSpeed.value time more to see if they want to double
		*/
	}
	
	var btn = addonMgrXulWin.window.document.querySelector('button[pref-name=' + settingKey + ']');
	btn.setAttribute('style', '');
	
	var lbl = addonMgrXulWin.window.document.querySelector('#label_' + settingKey);
	if (hotkeySetObj.keycode == 0 && lbl.value.indexOf(localize_Listening) > -1) {
		lbl.value = localize_NoKeySet;
	}
	if (lbl.value != localize_NoKeySet) {
		/*
		notify(lbl.value);
		notify(localize_Listening);
		notify(lbl.value.indexOf(localize_Listening));
		notify(lbl.value.replace(localize_Listening, ''));
		lbl.value = lbl.value.replace(localize_Listening, '');
		lbl.style.fontStyle = 'normal';
		*/
		var copySettingKey = settingKey;
		settingKey = null;
		prefs[copySettingKey].setval(copySettingKey, hotkeySetObj);	//myPrefListener._branch['set' + prefs[settingKey].type + 'Pref'](settingKey, JSON.stringify(prefs[settingKey].value));
	}
	
	settingKey = null;
	hotkeySetObj = {keycode:0,action:''};
}

function mouseDowned(e) {
	e.returnValue = false;
	e.preventDefault();
	e.stopPropagation();
	//var lbl = addonMgrXulWin.window.document.querySelector('#label_' + settingKey);
	//lbl.value = localize_NoKeySet;
	
	try {
		addonMgrXulWin.xulWindow.clearTimeout(timeoutWaitToSeeIfUserWantsToDblHit);
	} catch (ex) {
		notify('exception on: addonMgrXulWin.xulWindow.clearTimeout(timeoutWaitToSeeIfUserWantsToDblHit);');
	}
	
	exitInSet(true); //must go after the lbl thing above because in exitInSet settingKey is null'ed
	return false;
}

function notify(msg) {
    //notify(msg);
    //as.showAlertNotification('nullimg', 'JumpTab - Message', msg);
}

function tabSeld(window) {

    if (window.gBrowser && window.gBrowser.tabContainer) {
        var tab = window.gBrowser.selectedTab;
    } else {
        var tab = null;
    }
    if (wtHistory.length == 0 || wtHistory[wtHistory.length - 1][0] != window || wtHistory[wtHistory.length - 1][1] != tab)    {
        wtHistory.push([window, tab]);
        notify('tabSeld');
    }
}

function tabOpened(window) {    
    if (window.gBrowser && window.gBrowser.tabContainer) {
        var tab = window.gBrowser.selectedTab;
    } else {
        var tab = null;
    }
    if (wtHistory.length == 0 || wtHistory[wtHistory.length - 1][0] != window || wtHistory[wtHistory.length - 1][1] != tab)    {
    	wtHistory.push([window, tab]);
        notify('tabOpened');
	}
	
}

function cleanHistory() {

    //if (wtHistory.length == 0) { return }
    for (var j = 0; j < wtHistory.length; j++) {
        //var nsIXULWindow = wtHistory[j][0]; //.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation).QueryInterface(Ci.nsIDocShellTreeItem).treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIXULWindow);
        //notify(nsIXULWindow + ' instanceof xulwin = ' + nsIXULWindow instanceof Ci.nsIXULWindow);
        //above 2 commented lines was me trying to figure out how to detect if window closed
    	if ((!wtHistory[j][0] || wtHistory[j][0].closed) || (wtHistory[j][1] !== null && !wtHistory[j][1].parentNode)) {
			//(wtHistory[j][1] !== null && !wtHistory[j][1].parentNode) //tests if tab is still open
			//!wtHistory[j][0] //tests if window is still open
			wtHistory.splice(j, 1);
			j--;
            //if (wtHistory.length == 0) { notify('wtHistory length 0 return'); return }
			continue;
		}
		if (j < wtHistory.length - 1) {
			if (wtHistory[j][0] == wtHistory[j + 1][0] && wtHistory[j][1] == wtHistory[j + 1][1]) {
				wtHistory.splice(j, 1);
			}
		}
	}
}

function tabClosed(window) {
    //cleanHistory();
}

function winSeld(window) {
    if (window.gBrowser && window.gBrowser.tabContainer) {
        var tab = window.gBrowser.selectedTab;
    } else {
        var tab = null;
    }
    if (wtHistory.length == 0 || wtHistory[wtHistory.length - 1][0] != window || wtHistory[wtHistory.length - 1][1] != tab)    {
		wtHistory.push([window, tab]);
        notify('winSeld');
	}
}

function addonMgr() {
	//searches for addon manager tab and when found it returns the window element of it (the window is the equivlent of gBrowser.contentWindow from scratchpad)
	var windows = wm.getEnumerator('navigator:browser'); //gets all windows with gBrowser
	while (windows.hasMoreElements()) {
		var xulWindow = windows.getNext();
		var domWindow = xulWindow.QueryInterface(Ci.nsIDOMWindow);
		if (domWindow.gBrowser) {
			if (domWindow.gBrowser.tabContainer) {
				var browsers = domWindow.gBrowser.tabContainer.tabbrowser.browsers; //each tab is a browser
				for (var i=0; i<browsers.length; i++) {
					var loc = browsers[i].contentWindow.location;
					//notify('in this window tab ' + i + ' is at location of "' + loc + '"');
					if (loc == 'about:addons') {
						return {
							xulWindow: xulWindow,
							domWindow: domWindow,
							gBrowser: domWindow.gBrowser,
							window: browsers[i].contentWindow
						};
					}
				}
			} else {
				//no tab container
				var loc = domWindow.gBrowser.contentWindow.location;
				notify('no tab container in this window so just one gBrowser element. the location of this is "' + loc + '"');
				if (loc == 'about:addons') {
					return {
						xulWindow: xulWindow,
						domWindow: domWindow,
						gBrowser: domWindow.gBrowser,
						window: domWindow.gBrowser.contentWindow
					};
				}
			}
		}
	}
	
	return null;
}

var windowListener = {
	//DO NOT EDIT HERE
	onOpenWindow: function(aXULWindow) {
		// Wait for the window to finish loading
		let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
		aDOMWindow.addEventListener('load', function() {
			aDOMWindow.removeEventListener('load', arguments.callee, false);
			windowListener.loadIntoWindow(aDOMWindow);
		}, false);
	},
	onCloseWindow: function(aXULWindow) {},
	onWindowTitleChange: function(aXULWindow, aNewTitle) {},
	register: function() {
		 // Load into any existing windows
		 let XULWindows = wm.getEnumerator(null);
		 while (XULWindows.hasMoreElements()) {
			let aXULWindow = XULWindows.getNext();
			let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIDOMWindow);
			windowListener.loadIntoWindow(aDOMWindow, aXULWindow);
		 }
		 // Listen to new windows
		 wm.addListener(windowListener);
	},
	unregister: function() {
		// Unload from any existing windows
		let XULWindows = wm.getEnumerator(null);
		while (XULWindows.hasMoreElements()) {
			let aXULWindow = XULWindows.getNext();
			let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIDOMWindow);
			windowListener.unloadFromWindow(aDOMWindow, aXULWindow);
		}
		//Stop listening so future added windows dont get this attached
		wm.removeListener(windowListener);
	},
	//END - DO NOT EDIT HERE
	loadIntoWindow: function (aDOMWindow, aXULWindow) {
		var window = aDOMWindow;
		if (!window) { return; }
		
		window.addEventListener('keydown', function(event){ keyDownedListener(event, window) }, false);
		window.addEventListener('keyup', function(event){ keyUppedListener(event, window) }, false);
		window.addEventListener('focus', function(){ winSeld(window) }, false);
		window.addEventListener('activate', function(){ winSeld(window) }, false);
		
		if (window.gBrowser && window.gBrowser.tabContainer) {
			window.gBrowser.tabContainer.addEventListener('TabSelect', function(){ tabSeld(window) }, false);
			window.gBrowser.tabContainer.addEventListener('TabOpen', function(){ tabOpened(window) }, false);
			window.gBrowser.tabContainer.addEventListener('TabClose', function(){ tabClosed(window) }, false);
		}
		
	},
	unloadFromWindow: function (aDOMWindow, aXULWindow) {
		var window = aDOMWindow;
		if (!window) { return; }

		window.removeEventListener('keydown', function(event){ keyDownedListener(event, window) }, false);
		window.removeEventListener('keyup', function(event){ keyUppedListener(event, window) }, false);
		window.removeEventListener('focus', function(){ winSeld(window) }, false);
		window.removeEventListener('activate', function(){ winSeld(window) }, false);
		
		if (window.gBrowser && window.gBrowser.tabContainer) {
			window.gBrowser.tabContainer.removeEventListener('TabSelect', function(){ tabSeld(window) }, false);
			window.gBrowser.tabContainer.removeEventListener('TabOpen', function(){ tabOpened(window) }, false);
			window.gBrowser.tabContainer.removeEventListener('TabClose', function(){ tabClosed(window) }, false);
		}
	}
};

function jumpGlobal(window) {
    //considers windows with gBrowser and not
    
    
    //if window has gbrowser then
        //if window of last tab != window of current tab then just jump window
    //else FOR if window has gbrowser (so no gbrowser)
        //jumpt to last window
    
    
    cleanHistory();
    var jumped = false;
    if (wtHistory.length > 0) {
        for (var j = wtHistory.length - 1; j >= 0; j--) {
			if (window != wtHistory[j][0]) {
                //notify('foucsing:' + wtHistory[j][0].document.title);
                //cDump(wtHistory[j][0]);
                //notify('was at:' + window.document.title);
                //cDump(window);
				wtHistory[j][0].focus();
                jumped = true;
                break; //no need to change focus of tab as it was just window that was different
			}
            //at this point means window == wtHistory[j][0] so no need to change window
            if (window.gBrowser && window.gBrowser.tabContainer && window.gBrowser.selectedTab != wtHistory[j][1]) {
                //notify('HIT THIS');
                window.gBrowser.selectedTab = wtHistory[j][1];
				jumped = true;
				break;
			}
		}
		if (!jumped) {
			notify('Failed Jump - Other than current window and tab, nothing else found in history');
            as.showAlertNotification(selfPath + 'data/icon64.png', 'WorkspaceHopper - Global Hop Failed', 'Other than current window and tab, nothing else found in history');
		}
	} else {
		notify('Failed Jump - No history');
        as.showAlertNotification(selfPath + 'data/icon64.png', 'WorkspaceHopper - Global Hop Failed', 'No tab or window focus history');
	}
    
}

function jumpTab(window) {
    //if current window doesnt have gBrowser than jumps to window of last used tab
    //if current window has gbrowser and no last tab then notify, else jump to tab
	cleanHistory();
	var jumped = false;
    if (window.gBrowser && window.gBrowser.tabContainer) {
        for (var j=wtHistory.length-1; j>=0; j--) {
			if (wtHistory[j][0] == window) {
				if (wtHistory[j][1] != window.gBrowser.selectedTab) {
					jumped = true;
					window.gBrowser.selectedTab = wtHistory[j][1];
					break;
				}
			}
		}
		if (!jumped) {
			notify('Failed Jump - In this window, other than the current tab, no other tab was found in history');
            as.showAlertNotification(selfPath + 'data/icon64.png', 'WorkspaceHopper - Tab Hop Failed', 'In this window, other than the current tab, no other tab was found in focus history');
		}
    } else {
        for (var j=wtHistory.length-1; j>=0; j--) {
			if (wtHistory[j][1] !== null) {
				jumped = true;
				wtHistory[j][0].focus();
				//no need to focus the tab, just the window, as obviously: if this tab was the last selected tab, then when focus this window this will be the current tab
				break;
			}
		}
		if (!jumped) {
			notify('Failed Jump - This window has no tabs, so was looking for last window accessed with tab, could not find such a window. Meaning no tab was ever focused yet');
            as.showAlertNotification(selfPath + 'data/icon64.png', 'WorkspaceHopper - Tab Hop Failed', 'This window has no tabs, so was looking for a previously focused window that contained tabs, however could not find such a window');
		}
    }
}

function jumpWindow(window) {
    //jumps to last window
	cleanHistory();
    var jumped = false;
    if (wtHistory.length > 0) {
        for (var j=wtHistory.length-1; j>=0; j--) {
			if (wtHistory[j][0] != window) {
				jumped = true;
				wtHistory[j][0].focus();
				break;
			}
		}
		if (!jumped) {
			notify('Failed Jump - Other than current window, no other window found in history');
			as.showAlertNotification(selfPath + 'data/icon64.png', 'WorkspaceHopper - Window Hop Failed', 'Other than current window, no other window found in focus history');
		}
	} else {
		notify('Failed Jump - No windows found in history');
		as.showAlertNotification(selfPath + 'data/icon64.png', 'WorkspaceHopper - Window Hop Failed', 'No window focus history');
	}
}

//actions holds the keycode as key and each gets passed "e, window"
var action = {
    DEMO: {
        downed: function(e, window) {
            //fires on first key down, does not fire on second key down
            //does not fire between held and dblHeld
        },
        upped: function(e, window) {
            //see downed, does fire between held and dblHeld though
            //does not fire after held
        },
        held: function(e, window) {
            //first on held of first key down, on held after dblDowned does not fire
        },
        dblDowned: function(e, window) {
            //on second key down, so does fire between held and dblHeld
        },
        dblUpped: function(e, window) {
            //on second key up, does not fire after held or dblHeld
        },
        dblHeld: function(e, window) {
            //held after dblDowned
        }
    }
}


exports.main = function (options, callbacks) {
	//Cu.reportError('load reason: "' + options.loadReason + '"');
	
	addonMgrXulWin = addonMgr();
	//if (addonMgrXulWin) { //commented this block out as now using addonMgrXulWin.window.document in place of iOptsDoc
		//iOptsDoc = addonMgrXulWin.window.document;  //must run this addonWin block BEFORE myPrefListener register as this sets iOptsDoc which is used in the callback on startup
		//no need to worry that the options pane of this addon is open because it is in startup mode it is impossible that its open //actually this is not true, it can be there if say an update xpi is dragged over it
	//}
	
	if (['install','upgrade','downgrade'].indexOf(options.loadReason) > -1) {
		myPrefListener.setDefaults(); //in jetpack they get initialized somehow on install so no need for this	//on startup prefs must be initialized first thing, otherwise there is a chance that an added event listener gets called before settings are initalized
		//setDefaults safe to run after install too though because it wont change the current pref value if it is changed from the default.
		//good idea to always call setDefaults before register, especially if true for tirgger as if the prefs are not there the value in we are forcing it to use default value which is fine, but you know what i mean its not how i designed it, use of default is a backup plan for when something happens (like maybe pref removed)
	}
	myPrefListener.register(true); //true so it triggers the callback on registration, which sets value to current value
	
	/*
	//because restartless i have to check if pref exists first, if it doesn't then i have to set it with default val

	try {
		var existCheck_prevent_focus = prefs.getBoolPref('extensions.homepagenewtab.hide_search_field');
	} catch (ex) {
		prefs.setBoolPref('hide_search_field', false);
	}
	*/
    
    var recWin = wm.getMostRecentWindow(null);
    notify('recWin == ' + recWin);
    
    var recTab = null;
    if (recWin.gBrowser && recWin.gBrowser.tabContainer) {
        recTab = recWin.gBrowser.selectedTab;
    }
    wtHistory.push([recWin, recTab]);

	//register all observers
	for (var o in observers) {
		observers[o].reg();
	}
	
	//load into all existing windows and into future windows on open
	windowListener.register();

};

exports.onUnload = function(reason) {
    //Cu.reportError('onUnload reason: "' + reason + '"');

	//unregister all observers
	for (var o in observers) {
		observers[o].unreg();
	}

	//load into all existing windows and into future windows on open
	windowListener.unregister();
	
	if (['uninstall','downgrade','upgrade'].indexOf(reason) > -1) {
		Cu.reportError('deleting prance: ' + prefPrefix);
		ps.deleteBranch(prefPrefix);
	}
};