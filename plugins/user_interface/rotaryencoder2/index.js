'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
const path=require('path');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;

const Gpio = require('onoff').Gpio;
const inputEvent = require('input-event');
const io = require('socket.io-client');
const socket = io.connect('http://localhost:3000');
const dtoverlayRegex = /^([0-9]+):\s+rotary-encoder\s+pin_a=([0-9]+) pin_b=([0-9]+).*$/gm

const maxRotaries = 3;

const rotaryTypes = new Array(
	"...",
	"1/1",
	"1/2",
	"...",
	"1/4"
);

const dialActions = new Array(
	"DOTS",
	"VOLUME",
	"SKIP",
	"SEEK",
	"EMIT",
	"SCROLL"	
);

const btnActions = new Array(
	"DOTS",
	"PLAY",
	"PAUSE",
	"PLAYPAUSE",
	"STOP",
	"REPEAT",
	"RANDOM",
	"CLEARQUEUE",
	"MUTE",
	"UNMUTE",
	"TOGGLEMUTE",
	"SHUTDOWN",
	"REBOOT",
	"RESTARTAPP",
	"DUMPLOG",
	"EMIT",
);

module.exports = rotaryencoder2;
function rotaryencoder2(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;

}



rotaryencoder2.prototype.onVolumioStart = function()
{
	var self = this;
	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

	self.debugLogging = (self.config.get('logging')==true);
	self.inputs=[].fill(null,0,maxRotaries);
	self.events=[].fill(null,0,maxRotaries);
	self.buttons=[].fill(null,0,maxRotaries);
	self.pushDownTime=[].fill(0,0,maxRotaries);
	self.status=null;
    return libQ.resolve();
}

rotaryencoder2.prototype.onStart = function() {
    var self = this;
	var defer=libQ.defer();
	var activate = [];

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onStart: Config loaded: ' + JSON.stringify(self.config));
	for (let i = 0; i < maxRotaries; i++) {
		if (self.config.get('enabled'+i)) {
			activate.push(i);
		}	
	}
	socket.emit('getState');
	socket.on('pushState',function(data){
		self.status = data;
		self.lastTime = data.seek - Date.now();
		// if (self.debugLogging) self.logger.info('[ROTARYENCODER2] received Websock Status: ' + JSON.stringify(self.status));
	})
	self.activateRotaries(activate)
	.then(_ => {
 		self.commandRouter.pushToastMessage('success',"Rotary Encoder II",  self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_START_SUCCESS'))
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onStart: Plugin successfully started.');				
		defer.resolve();
	})
	.fail(err => {
		self.commandRouter.pushToastMessage('error',"Rotary Encoder II", self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_STOP_FAIL'))
		self.logger.error('[ROTARYENCODER2] onStart: Failed to start plugin:' + err)
		defer.reject();
	});

    return defer.promise;
};

rotaryencoder2.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();
	var deactivate=[];

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onStop: Stopping Plugin.');

	for (let i = 0; i < maxRotaries; i++) {
		if (self.config.get('enabled'+i)) {
			deactivate.push(i);
		}	
	}
	socket.off();
	self.deactivateRotaries(deactivate)
	.then(_ => {
		self.commandRouter.pushToastMessage('success',"Rotary Encoder II", self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_STOP_SUCCESS'))
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onStop: Plugin successfully stopped.');				
		defer.resolve();
	})
	.fail(err => {
		self.commandRouter.pushToastMessage('error',"Rotary Encoder II", self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_STOP_FAIL'))
		self.logger.error('[ROTARYENCODER2] onStop: Failed to stop plugin.');
		defer.reject();
	})
    return defer.promise;
};

rotaryencoder2.prototype.onRestart = function() {
    var self = this;
    var defer=libQ.defer();

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onRestart: free resources');
	this.onStop()
	.then(result=> defer.resolve(result))
	.fail(err => defer.reject(err))

	return defer.promise;
};


// Configuration Methods -----------------------------------------------------------------------------

rotaryencoder2.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
			//Settings for rotaries
			for (let i = 0; i < maxRotaries; i++) {
				uiconf.sections[i].content[0].value = (self.config.get('enabled' + i)==true)
				uiconf.sections[i].content[1].value.value = self.config.get('rotaryType' + i) | 0;
				uiconf.sections[i].content[1].value.label = rotaryTypes[parseInt(self.config.get('rotaryType' + i))|0];
				uiconf.sections[i].content[2].value = parseInt(self.config.get('pinA' + i)) | 0;
				uiconf.sections[i].content[3].value = parseInt(self.config.get('pinB' + i)) | 0;
				uiconf.sections[i].content[4].value.value = self.config.get('dialAction' + i) | 0;
				uiconf.sections[i].content[4].value.label = self.commandRouter.getI18nString('ROTARYENCODER2.'+dialActions[parseInt(self.config.get('dialAction' + i))|0]);
				uiconf.sections[i].content[5].value = self.config.get('socketCmdCCW' + i);
				uiconf.sections[i].content[6].value = self.config.get('socketDataCCW' + i);
				uiconf.sections[i].content[7].value = self.config.get('socketCmdCW' + i);
				uiconf.sections[i].content[8].value = self.config.get('socketDataCW' + i);
				uiconf.sections[i].content[9].value = parseInt(self.config.get('pinPush' + i)) | 0;
				uiconf.sections[i].content[10].value = parseInt(self.config.get('pinPushDebounce' + i)) | 0;
				uiconf.sections[i].content[11].value = (self.config.get('pushState' + i)==true)
				uiconf.sections[i].content[12].value.value = self.config.get('pushAction' + i) | 0;
				uiconf.sections[i].content[12].value.label = self.commandRouter.getI18nString('ROTARYENCODER2.'+btnActions[parseInt(self.config.get('pushAction' + i))|0]);
				uiconf.sections[i].content[13].value = self.config.get('socketCmdPush' + i);
				uiconf.sections[i].content[14].value = self.config.get('socketDataPush' + i);
				uiconf.sections[i].content[15].value.value = self.config.get('longPushAction' + i) | 0;
				uiconf.sections[i].content[15].value.label = self.commandRouter.getI18nString('ROTARYENCODER2.'+btnActions[parseInt(self.config.get('longPushAction' + i))|0]);
				uiconf.sections[i].content[16].value = self.config.get('socketCmdLongPush' + i);
				uiconf.sections[i].content[17].value = self.config.get('socketDataLongPush' + i);	
			}
			//logging section
			uiconf.sections[maxRotaries].content[0].value = (self.config.get('logging')==true)
            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });

    return defer.promise;
};

rotaryencoder2.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

rotaryencoder2.prototype.getI18nFile = function (langCode) {
	const i18nFiles = fs.readdirSync(path.join(__dirname, 'i18n'));
	const langFile = 'strings_' + langCode + '.json';
  
	// check for i18n file fitting the system language
	if (i18nFiles.some(function (i18nFile) { return i18nFile === langFile; })) {
	  return path.join(__dirname, 'i18n', langFile);
	}
	// return default i18n file
	return path.join(__dirname, 'i18n', 'strings_en.json');
  };
  
rotaryencoder2.prototype.updateEncoder = function(data){
	var self = this;
	var defer = libQ.defer();
	var dataString = JSON.stringify(data);
	var overlayToRemove = -1

	var rotaryIndex = parseInt(dataString.match(/rotaryType([0-9])/)[1]);
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] updateEncoder: Updating Encoder '+(rotaryIndex + 1)+' Settings:' + JSON.stringify(data));

	self.sanityCheckSettings(rotaryIndex,data)
	.then(_ => {
		var oldPinA = self.config.get('pinA'+rotaryIndex);
		var oldPinB = self.config.get('pinB'+rotaryIndex);
		var newPinA = data['pinA'+rotaryIndex];
		var newPinB = data['pinB'+rotaryIndex];
		return self.checkDTOverlayExists(oldPinA,oldPinB)
		.then(resOld =>{
			switch (resOld.found) {
				case 'same':
					overlayToRemove = resOld.overlay;
					break;
				case 'none':
					break;
				default:
					self.logger.error('[ROTARYENCODER2] updateEncoder: GPIOs of rotary '+(rotaryIndex + 1)+' seem to be used by other overlay:' + resOld);
					defer.reject('old Rotary setting not matching with situation on system');
					break;
			}
		})
		.then(_ => self.checkDTOverlayExists(newPinA,newPinB))
		.then(resNew => {
			switch (resNew.found) {
				case 'same':
					if (overlayToRemove == resNew.overlay)
					return self.deactivateButton(rotaryIndex)
					.then(_ => self.unregisterEvents(rotaryIndex))
					// self.unregisterEvents(rotaryIndex)
					.then(_ => self.unassignInput(rotaryIndex))
					break;
				case 'other':
				case 'swap':
					if (overlayToRemove == resNew.overlay)
					return self.deactivateRotaries([rotaryIndex])
					break;
				case 'multi':
					self.commandRouter.pushToastMessage('Error', self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_GPIO_BLOCKED'),self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_MSG_OVERLAY_BLOCKING'));
					defer.reject(err);
					break;
				default:
					break;
			}
		})
	})
	.then(_ => {
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] updateEncoder: Changing Encoder '+(rotaryIndex + 1)+' Settings to new values');
		if (data['enabled'+rotaryIndex]==true) {
			self.config.set('rotaryType'+rotaryIndex, (data['rotaryType'+rotaryIndex].value));
			self.config.set('pinA'+rotaryIndex, (data['pinA'+rotaryIndex]));
			self.config.set('pinB'+rotaryIndex, (data['pinB'+rotaryIndex]));
			self.config.set('dialAction'+rotaryIndex, (data['dialAction'+rotaryIndex].value));
			self.config.set('socketCmdCCW'+rotaryIndex, (data['socketCmdCCW'+rotaryIndex]));
			self.config.set('socketDataCCW'+rotaryIndex, (data['socketDataCCW'+rotaryIndex]));
			self.config.set('socketCmdCW'+rotaryIndex, (data['socketCmdCW'+rotaryIndex]));
			self.config.set('socketDataCW'+rotaryIndex, (data['socketDataCW'+rotaryIndex]));
			self.config.set('pinPush'+rotaryIndex, (data['pinPush'+rotaryIndex]));
			self.config.set('pinPushDebounce'+rotaryIndex, (data['pinPushDebounce'+rotaryIndex]));
			self.config.set('pushState'+rotaryIndex,(data['pushState'+rotaryIndex]))
			self.config.set('pushAction'+rotaryIndex, (data['pushAction'+rotaryIndex].value));
			self.config.set('socketCmdPush'+rotaryIndex, (data['socketCmdPush'+rotaryIndex]));
			self.config.set('socketDataPush'+rotaryIndex, (data['socketDataPush'+rotaryIndex]));
			self.config.set('longPushAction'+rotaryIndex, (data['longPushAction'+rotaryIndex].value));
			self.config.set('socketCmdLongPush'+rotaryIndex, (data['socketCmdLongPush'+rotaryIndex]));
			self.config.set('socketDataLongPush'+rotaryIndex, (data['socketDataLongPush'+rotaryIndex]));
			self.config.set('enabled'+rotaryIndex, (data['enabled'+rotaryIndex]));	
		} else {
			self.config.set('rotaryType'+rotaryIndex, 0);
			self.config.set('pinA'+rotaryIndex, "");
			self.config.set('pinB'+rotaryIndex, "");
			self.config.set('dialAction'+rotaryIndex, 0);
			self.config.set('socketCmdCCW'+rotaryIndex, "");
			self.config.set('socketDataCCW'+rotaryIndex, "");
			self.config.set('socketCmdCW'+rotaryIndex, "");
			self.config.set('socketDataCW'+rotaryIndex, "");
			self.config.set('pinPush'+rotaryIndex, "");
			self.config.set('pinPushDebounce'+rotaryIndex, "");
			self.config.set('pushState'+rotaryIndex,false)
			self.config.set('pushAction'+rotaryIndex, 0);
			self.config.set('socketCmdPush'+rotaryIndex, "");
			self.config.set('socketDataPush'+rotaryIndex, "");
			self.config.set('longPushAction'+rotaryIndex, 0);
			self.config.set('socketCmdLongPush'+rotaryIndex, "");
			self.config.set('socketDataLongPush'+rotaryIndex, "");
			self.config.set('enabled'+rotaryIndex, (data['enabled'+rotaryIndex]));	
		}
	})
	.then(_=> {
		if (self.config.get('enabled'+rotaryIndex)) {
				return self.activateRotaries([rotaryIndex])						
			}
	})
	.then(_ => {
		self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_SAVE_SUCCESS'), self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_MSG_SAVE')+ (rotaryIndex + 1));
		defer.resolve();	
	})
	.fail(err => {
		self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_SAVE_FAIL'), self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_MSG_SAVE')+ (rotaryIndex + 1));
		defer.reject(err);
	})
	return defer.promise;

}

rotaryencoder2.prototype.sanityCheckSettings = function(rotaryIndex, data){
	//KOMPLETT DEBUGGEN
	var self = this;
	var defer = libQ.defer();
	var newPins = [];
	var otherPins = [];
	var allPins = [];
	
	// First check if the settings make sense for themselves
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] sanityCheckSettings: Rotary'+(rotaryIndex + 1)+'for:' + JSON.stringify(data));

	if (data['enabled'+rotaryIndex] == false) {
		if (self.config.get('enabled'+rotaryIndex) == true) {
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] sanityCheckSettings: Disabling rotary ' + (rotaryIndex+1) +' is OK.' );
			defer.resolve('pass');	
		} else {
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] sanityCheckSettings: Rotary ' + (rotaryIndex+1) +' was already disabled, nothing to do.' );
			defer.resolve('pass');	
		}
	} else {
		if (!Number.isInteger(parseInt(data['pinA'+rotaryIndex])) || !Number.isInteger(parseInt(data['pinB'+rotaryIndex])) || !Number.isInteger(parseInt(data['pinPush'+rotaryIndex]))) {
			self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_WRONG_PARAMETER'), self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_NEEDS_INTEGER'));
			defer.reject('Pin value must be integer.')
		} 
		newPins = [parseInt(data['pinA'+rotaryIndex]),parseInt(data['pinB'+rotaryIndex]),parseInt(data['pinPush'+rotaryIndex])];
		for (let i = 0; i < maxRotaries; i++) {
			if ((!i==rotaryIndex) && (this.config.get('enabled'+i))) {
				otherPins.push(parseInt(this.config.get('pinA'+i)));
				otherPins.push(parseInt(this.config.get('pinB'+i)));
				otherPins.push(parseInt(this.config.get('pinPush'+i)));
			}
		}
		if (newPins.some((item,index) => newPins.indexOf(item) != index)) {
			self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_WRONG_PARAMETER'), self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_PINS_DIFFERENT'));
			self.logger.error('[ROTARYENCODER2] sanityCheckSettings: duplicate pins. new: ' + newPins );
			defer.reject('Duplicate pin numbers provided.')
		}
		allPins = [...otherPins, ...newPins];
		if (allPins.some((item,index) => allPins.indexOf(item) != index)) {
			self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_WRONG_PARAMETER'), self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_PINS_BLOCKED')+(rotaryIndex+1));
			self.logger.error('[ROTARYENCODER2] sanityCheckSettings: Pin(s) used in other rotary already. other:' + oldPins +' new: ' + newPins );
			defer.reject('One or more pins already used in other rotary.')
		} else {
			defer.resolve('pass');	
		}
		
	}
	return defer.promise;
}

rotaryencoder2.prototype.updateDebugSettings = function (data) {
	var self = this;
	var defer = libQ.defer();
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] updateDebugSettings: Saving Debug Settings:' + JSON.stringify(data));
	self.config.set('logging', (data['logging']))
	self.debugLogging = data['logging'];
	defer.resolve();
	self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_SAVE_SUCCESS'), self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_DEBUG_SAVE'));
	return defer.promise;
};

rotaryencoder2.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

rotaryencoder2.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

rotaryencoder2.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};

/**
 * Function looks for rotary-encoder overlays that alread use one of the provided GPIOs.
 * It returns a JSON object with 2 keys: 'found' and 'overlay'
 * 'found' contains a value indicating what was found:
 * 'same': the exact same overlay exists
 * 'swap': an overlay with the same gpios exists, but they are swapped (e.g. if the user swaps pins to change turning direction)
 * 'other': pins are used in more than one overlay alread
 * 'none': none of the pins is used in any overlay
 * 'multi': multiple overlays are found, where the pins are used
 * In case of 'same' and 'swap', 'overlay' contains the overlay ID as returned by 'dtoverlay -l', if 'other' or 'none' is returned
 * 'overlay' is empty
 * @param {Number} pin_a 
 * @param {Number} pin_b 
 * @returns {object}
 */
rotaryencoder2.prototype.checkDTOverlayExists = function(pin_a, pin_b) {
	var self = this;
	var defer = libQ.defer();
    var match;
    var overlay = "";
	var found = "none"

	if (isNaN(pin_a) || isNaN(pin_b)) {
		self.logger.error('[ROTARYENCODER2] checkDTOverlayExists: pin_a and pin_b need to be numeric.');
		defer.reject('checkDTOverlayExists: Parameters need to be numeric.');
	} else {
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] checkDTOverlayExists: Checking for existing overlays for GPIOs: '+pin_a+' & '+pin_b);
		exec('/usr/bin/sudo /usr/bin/dtoverlay -l', {uid: 1000, gid: 1000}, function (err, stdout, stderr) {
			if(err) {
				self.logger.error('[ROTARYENCODER2] checkDTOverlayExists: Could not execute "dtoverlays -l": ' + stderr);
				defer.reject('checkDTOverlayExists: dtoverlay -l execution failed');
			}
			while (match = dtoverlayRegex.exec(stdout)) {
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] checkDTOverlayExists: Existing Rotary overlays:' + match[0]);
				if (overlay != "" && (pin_a == match[2] || pin_b == match[2] || pin_a == match[3] || pin_b == match[3])){
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] checkDTOverlayExists: Another overlay found: ' + match[1]);
					overlay = '';
					found = "multi";
				} else if (pin_a == match[2] && pin_b == match[3])  {
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] checkDTOverlayExists: Matching overlay found: ' + match[1]);
					overlay = match[1];
					found = "same";
				} else if (pin_a == match[3] && pin_b == match[2])  {
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] checkDTOverlayExists: Matching overlay with swapped GPIOs found: ' + match[1]);
					overlay = match[1];
					found = "swap";
				} else if (pin_a == match[2] || pin_b == match[2] || pin_a == match[3] || pin_b == match[3])  {
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] checkDTOverlayExists: One or both pins used in other overlay: ' + match[1]);
					overlay = match[1];
					found = "other";
					break;
				}             
			}
			defer.resolve({'found':found, 'overlay':overlay});
		});	
	}
	return defer.promise;
}

/**
 * Removes overlays from device tree. Rotary index is the rotary number in code (starting with 0). In the
 * GUI numbering starts with 1 (so for all messages to the user index is increased by 1)
 * @param {number} rotaryIndex number of the rotary to be removed (zero based, different from GUI)
 * @returns {void}
 */
rotaryencoder2.prototype.removeDTOverlay = function(overlayIndex) {
	var self = this;
	var defer = libQ.defer();

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] removeDTOverlay: Overlays to be removed: ' + overlayIndex);
	var i = overlayIndex;
	exec('/usr/bin/sudo /usr/bin/dtoverlay -r ' + i, {uid: 1000, gid: 1000}, function (err, stdout, stderr) {
				if(err) {
					self.logger.error('[ROTARYENCODER2] removeDTOverlay: Failed to delete overlay: ' + i +' - '+ stderr);
					defer.reject('removeDTOverlay: dtoverlay -r failed');
				} else {
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] removeDTOverlay: Successfully deleted dtoverlay ' + i);
					defer.resolve();
				}
	});  
	return defer.promise;
}

/**
 * Adds rotary encoder to device tree overlay with pin_a and pin_b as connected IO and the
 * defined number of steps per Period. To change turning direction of rotary swap pins.
 * For details see:
 * https://www.kernel.org/doc/Documentation/input/rotary-encoder.txt
 * @param {} pin_a First pin of the rotary (sometimes called CLK)
 * @param {*} pin_b Second pin of the rotary (sometimes called DAT or DET)
 * @param {*} stepsPerPeriod If the rotary has click positions, this parameter describes, how many clicks occur per complete transition (high-low-high)
 * @returns 
 */
rotaryencoder2.prototype.addDTOverlay = function(rotaryIndex){
	var self = this;
	var defer = libQ.defer();

	var pin_a = self.config.get('pinA'+rotaryIndex);
	var pin_b = self.config.get('pinB'+rotaryIndex);
	var stepsPerPeriod = self.config.get('rotaryType'+rotaryIndex);

    var parameter = 'rotary-encoder pin_a=' + pin_a + ' pin_b=' + pin_b + ' relative_axis=true steps-per-period=' + stepsPerPeriod
    if (self.debugLogging) self.logger.info('[ROTARYENCODER2] addDTOverlay: Adding overlay: ' + parameter)
    exec('/usr/bin/sudo /usr/bin/dtoverlay ' + parameter, {uid: 1000, gid: 1000}, function (err, stdout, stderr) {
        if(err) {
			self.logger.error('[ROTARYENCODER2] addDTOverlay: Failed to add overlay: ' + stderr);
			defer.reject('addDTOverlay: dtoverlay add failed');
		} else {
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] addDTOverlay: Overlay successfully added: ' + stdout);
			defer.resolve();	
		} 
    });
	return defer.promise;  
}

rotaryencoder2.prototype.activateButton = function (rotaryIndex) {
	var self = this;
	var defer = libQ.defer();
	var cmd = '';
	var data = '';
	
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] activateButton: activate button for rotary ' + (rotaryIndex + 1));

	if (Gpio.accessible) {
		var pin = this.config.get('pinPush'+rotaryIndex);
		var timeout = this.config.get('pinPushDebounce'+rotaryIndex);		
		this.buttons[rotaryIndex] = new Gpio(pin,'in','both',{debounceTimeout: timeout});
		this.buttons[rotaryIndex].watch((err, value) => {
			if(err) {
				self.logger.error('[ROTARYENCODER2] activateButton: Failed trigger by button of rotary ' + (rotaryIndex + 1) + ': ' + stderr);
			}
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] activateButton: button of rotary ' + (rotaryIndex + 1) + ' received: '+value);			
			var timeNow = new Date();
			var active = self.config.get('pushState'+rotaryIndex)?0:1;
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] activateButton: active ' + active);
			if (value == active) {
			  self.pushDownTime = timeNow;
			  if (self.debugLogging) self.logger.info('[ROTARYENCODER2] buttonAction: pressed at ' + timeNow);
			} else {
			  this.buttonAction(timeNow - self.pushDownTime, rotaryIndex);
			}
		})
		defer.resolve();
	} else {
		self.logger.error('[ROTARYENCODER2] activateButton: Cannot access GPIOs.');
		defer.reject('activateButton: Cannot access GPIOs.');
	}
	return defer.promise;
}

rotaryencoder2.prototype.buttonAction = function (duration, rotaryIndex) {
	var self = this;
	var cmd = '';
	var data = '';
	var execute = 0;

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] buttonAction: button of rotary ' + (rotaryIndex + 1) + ' pressed for ' + duration + ' ms.');
	if (duration > 1500) {  //long-press
		execute = this.config.get('longPushAction' + rotaryIndex)|0;
		if (execute == btnActions.indexOf("EMIT")) {
			cmd = self.config.get('socketCmdLongPush' + rotaryIndex);
			data = self.config.get('socketDataLongPush' + rotaryIndex);
		} 
	} else {
		execute = this.config.get('pushAction' + rotaryIndex)|0;
		if (execute == btnActions.indexOf("EMIT")) {
			cmd = self.config.get('socketCmdPush' + rotaryIndex);
			data = self.config.get('socketDataPush' + rotaryIndex);
		} 
	}
	switch (execute) {
		case btnActions.indexOf("DOTS"):
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] buttonAction: button of rotary ' + (rotaryIndex + 1) + ' pressed but no action selected.');
			break;
		case btnActions.indexOf("PLAY"):
			socket.emit('play','')
			break;
		case btnActions.indexOf("PAUSE"):
			socket.emit('pause','')
			break;
		case btnActions.indexOf("PLAYPAUSE"):
			socket.emit('toggle','')
			break;
		case btnActions.indexOf("STOP"):
			socket.emit('stop','')
			break;
		case btnActions.indexOf("REPEAT"):
			var newVal = !(self.status.repeat && self.status.repeatSingle);
			var newSingle = !(self.status.repeat == self.status.repeatSingle);
			socket.emit('setRepeat',{
				'value': newVal,
				'repeatSingle': newSingle
			})
			break;
		case btnActions.indexOf("RANDOM"):
			socket.emit('setRandom',{'value':!self.status.random})
			break;
		case btnActions.indexOf("CLEARQUEUE"):
			socket.emit('clearQueue','')
			break;
		case btnActions.indexOf("MUTE"):
			socket.emit('mute','')
			break;
		case btnActions.indexOf("UNMUTE"):
			socket.emit('unmute','')
			break;
		case btnActions.indexOf("TOGGLEMUTE"):
			if (self.status.mute) {
				socket.emit('unmute','');
			} else {
				socket.emit('mute','');
			}
			break;
		case btnActions.indexOf("SHUTDOWN"):
			socket.emit('shutdown','')
			break;
		case btnActions.indexOf("REBOOT"):
			socket.emit('reboot','')
			break;
		case btnActions.indexOf("EMIT"):
			socket.emit(cmd,data);
			break;
		default:
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] buttonAction: button of rotary ' + (rotaryIndex + 1) + ' pressed but no action defined in code yet.');
			break;
	}
}

rotaryencoder2.prototype.deactivateButton = function (rotaryIndex) {
	var self = this;
	var defer = libQ.defer();
	
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] deactivateButton: called for rotary ' + (rotaryIndex + 1));
	try {
		if (this.buttons[rotaryIndex] != null) {
			this.buttons[rotaryIndex].unwatchAll();
			this.buttons[rotaryIndex].unexport();	
			this.buttons[rotaryIndex] = null;			
		}
		self.logger.error('[ROTARYENCODER2] deactivateButton: Done');
		defer.resolve();
	} catch (error) {
		self.logger.error('[ROTARYENCODER2] deactivateButton: Failed to destroy objects.');
		defer.reject();
	}
	return defer.promise;	
}

/** Handles complete activation of Rotary
 *  Installs overlay, registers inputs and events for rotary and button
 *  Calls checkDTOverlayExists before registering overlay
 *  Reuses overlay if 'same' and only installs events/inputs, adds overlay if 'none', rejects if 'other' or 'swap'
 * @param {*} indexArray 
 * @returns 
 */
rotaryencoder2.prototype.activateRotaries = function(indexArray) {
	var self = this;
	var defer = libQ.defer();

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] activateRotaries: activate [' + indexArray.map(n => n + 1) + ']');
	if (indexArray.length > 0) {
		var rotaryIndex = indexArray[indexArray.length - 1];
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] activateRotaries: Adding overlay for Rotary ' + (rotaryIndex+1));
		self.checkDTOverlayExists(self.config.get('pinA' + rotaryIndex),self.config.get('pinB'+rotaryIndex))
		.then(result => {
			switch (result.found) {
				case 'none':
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] activateRotaries: switch none ' + JSON.stringify(result));
					return self.addDTOverlay(rotaryIndex);
				case 'same':
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] activateRotaries: switch same ' + JSON.stringify(result));
					return;
				default:
					self.logger.error('[ROTARYENCODER2] activateRotaries: activate rotary ' + (rotaryIndex + 1) + 'failed: ' + JSON.stringify(result));
					defer.reject();
					return;
			}
		})
		.then(_ => {return self.assignInput(rotaryIndex)})
		.then(_=> {return self.registerEvents(rotaryIndex)})
		.then(_ => {return self.activateButton(rotaryIndex)})
		.then(_=> {return self.activateRotaries(indexArray.slice(0,indexArray.length - 1))}) //recurse
		.then(_=> defer.resolve());
	} else {
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] activateRotaries: No rotaries left to activate.');
		defer.resolve();
	}
	return defer.promise;
}
/** Handles complete deactivation of Rotary
 * 	Removes events, inputs and overlays of buttons and rotary
 *  Calls checkDTOverlayExists before trying to remove DToverlay
 * 	Removes in same and swap case, throws reject in case of other, does nothing if 'none' found
 * @param {} indexArray 
 * @returns 
 */
rotaryencoder2.prototype.deactivateRotaries = function(indexArray) {
	var self = this;
	var defer = libQ.defer();

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] DeactivateRotaries: deactivate ['+ indexArray.map(n => n + 1) + ']');
	if (indexArray.length > 0) {
		var rotaryIndex = indexArray[indexArray.length-1];
		var pin_a =self.config.get('pinA'+rotaryIndex)|0;
		var pin_b= self.config.get('pinB'+rotaryIndex)|0;
		self.deactivateButton(rotaryIndex)
		.then(_ => {return self.unregisterEvents(rotaryIndex)})
		// self.unregisterEvents(rotaryIndex)
		.then(_ => {return self.unassignInput(rotaryIndex)})
		.then(_=> {return self.checkDTOverlayExists(pin_a, pin_b)})
		.then(result => {
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] DeactivateRotaries: "this.checkDTOverlayExists" returned: '+ JSON.stringify(result) +'.');
			switch (result.found) {
				case 'none':
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] DeactivateRotaries: No blocking Overlay, nothing to remove.');
					break;
				case 'other':
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] DeactivateRotaries: Cannot remove blocked overlay, disable the rotary using it.' + result[0]);
					defer.reject('DeactivateRotaries: Cannot remove blocked overlay, disable the rotary using it.');
					break;
				default:
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] DeactivateRotaries: Now removing overlay of rotary '+(rotaryIndex + 1));
					return self.removeDTOverlay(result.overlay);
			}
		})	
		.then(_=> {return self.deactivateRotaries(indexArray.slice(0,indexArray.length-1))}) //recurse
		.then(_ => defer.resolve())
		.fail(err =>{
			self.logger.error('[ROTARYENCODER2] DeactivateRotaries: Failed: ' + err);
			defer.reject(err);
		})		
	} else {
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] DeactivateRotaries: No overlays left to remove.');
		defer.resolve();
	}
	return defer.promise;
}

rotaryencoder2.prototype.assignInput = function(rotaryIndex) {
	var self = this;
	var defer = libQ.defer();
	var devString;
	var pinAHex

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] assignInput: called for rotary: ' + (rotaryIndex+1))

	if (self.inputs[rotaryIndex] != null) {
		self.logger.error('[ROTARYENCODER2] assignInput: Input ' + rotaryIndex + ' for Rotary ' + (rotaryIndex+1) + ' still assigned.')
		defer.reject();
	} else {
		pinAHex = parseInt(self.config.get('pinA'+rotaryIndex)).toString(16);
		devString = '/dev/input/by-path/platform-rotary\@'+ pinAHex +'-event';
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] assignInput: Assigning input ' + devString)
		self.inputs[rotaryIndex] = new inputEvent(devString);
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] assignInput: done ' + JSON.stringify(self.inputs[rotaryIndex]))
		defer.resolve();
	}
	return defer.promise;
}

rotaryencoder2.prototype.unassignInput = function(rotaryIndex) {
	var self = this;
	var defer = libQ.defer();

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] unassignInput: Called for rotary: ' + (rotaryIndex + 1))

	if (self.events[rotaryIndex] != null) {
		self.logger.error('[ROTARYENCODER2] assignInput: Events for Decoder ' + (rotaryIndex + 1) + ' not unregistered yet.')
		defer.reject();
	} else {
		if (self.inputs[rotaryIndex] != null) {
			try {
				self.inputs[rotaryIndex].close;
				self.inputs[rotaryIndex] = null;
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] UnassignInput: Done for rotary: ' + (rotaryIndex+1))
				defer.resolve();					
			} catch (error) {
				self.logger.error('[ROTARYENCODER2] UnassignInput: Failed for rotary: ' + (rotaryIndex+1))
				defer.reject(error);				
			}
		}
	}
	return defer.promise;
}

rotaryencoder2.prototype.registerEvents = function(rotaryIndex) {
	var self = this;
	var defer = libQ.defer();

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] registerEvents: Called for rotary: ' + (rotaryIndex +1))

	if (self.events[rotaryIndex] != null) {
		self.logger.error('[ROTARYENCODER2] registerEvents: Events for Rotary ' + (rotaryIndex+1) + ' still assigned.')
		defer.reject();		
	} else {
		let action = parseInt(self.config.get('dialAction'+rotaryIndex));
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] registerEvents: Registering event:' + action +' for input ' + rotaryIndex)
		try {
			self.events[rotaryIndex] = new inputEvent.Rotary(self.inputs[rotaryIndex]);			
		} catch (error) {
				self.logger.info('[ROTARYENCODER2] registerEvents: Failed to generate inputEvent for Rotary ' + (rotaryIndex + 1))
			defer.reject(error);
		}
		switch (action) {
			case 1: //Volume
				self.events[rotaryIndex].on('left', _ => socket.emit('volume', '-'));
				self.events[rotaryIndex].on('right', _ => socket.emit('volume', '+'));
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] registerEvents: "Volume" for rotary '+(rotaryIndex+1));
				defer.resolve();
				break;
			case 2: //Skip
				self.events[rotaryIndex].on('left', _ => socket.emit('prev', ''));
				self.events[rotaryIndex].on('right', _ => socket.emit('next', ''));
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] registerEvents: "Skip" for rotary '+(rotaryIndex+1));
				defer.resolve();
				break;	
			case 3: //seek
				self.events[rotaryIndex].on('left', _ => {
					if (self.status.trackType != 'webradio' && self.status.status == 'play') {
						let jumpTo = Math.min(Math.floor((Date.now() + self.lastTime)/1000 - 10),Math.floor(self.status.duration/1000));
						if (self.debugLogging) self.logger.info('[ROTARYENCODER2] skip back to: ' + jumpTo);
						socket.emit('seek', jumpTo);
					}
				});
				self.events[rotaryIndex].on('right', _ => {  // Elapsed + (date.now - date.old) + 10
					if (self.status.trackType != 'webradio' && self.status.status == 'play') {
						let jumpTo = Math.min(Math.floor((Date.now() + self.lastTime)/1000 + 10),Math.floor(self.status.duration));
						if (self.debugLogging) self.logger.info('[ROTARYENCODER2] skip fwd to: ' + jumpTo);
						socket.emit('seek', jumpTo);
					}
				});
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] Registered "Seek" for rotary '+(rotaryIndex+1));
				defer.resolve();
				break;	
			case 4: //socket command
				self.events[rotaryIndex].on('left', _ => socket.emit(self.config.get('socketCmdCCW'+rotaryIndex),self.config.get('socketDataCCW'+rotaryIndex)));
				self.events[rotaryIndex].on('right', _ => socket.emit(self.config.get('socketCmdCW'+rotaryIndex),self.config.get('socketDataCW'+rotaryIndex)));
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] registerEvents: socketCmd '+ self.config.get('socketCmdCCW'+rotaryIndex) + '/' + self.config.get('socketCmdCW'+rotaryIndex)+' for rotary '+(rotaryIndex+1));				
				defer.resolve();
				break;
			default:
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] registerEvents: no Event selected');				
				self.events[rotaryIndex].on('left', ev => self.logger.info('[ROTARYENCODER2] registerEvents: Rotary '+(rotaryIndex+1)+' rotated left'));
				self.events[rotaryIndex].on('right', ev => self.logger.info('[ROTARYENCODER2] registerEvents: Rotary '+(rotaryIndex+1)+' rotated right'));
				defer.resolve();
				break;
		}
	}
	return defer.promise;
}

rotaryencoder2.prototype.unregisterEvents = function(rotaryIndex) {
	var self = this;
	var defer = libQ.defer();

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] unregisterEvents: Called for rotary: ' + (rotaryIndex + 1))
	var i = rotaryIndex;
	if (self.events[i] != null) {
		try {
			self.events[i].removeAllListeners();
			self.events[i].close();
			self.events[i] = null;				
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] unregisterEvents: Done for rotary: ' + (rotaryIndex + 1))
			defer.resolve();
		} catch (error) {
			self.logger.error('[ROTARYENCODER2] unregisterEvents: Failed for rotary: ' + (rotaryIndex + 1))
			defer.reject(error)			
		}
	};
	return defer.promise;
}
