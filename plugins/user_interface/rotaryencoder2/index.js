'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
const path=require('path');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var spawn = require("child_process").spawn

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
	self.handles=[].fill(null,0,maxRotaries);
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
	try {
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onStart: Now assign Inputs: ' + (self.input_center) + ' ' + (self.input_right));
		self.button = new Gpio(22, 'in', 'falling', {debounceTimeout: 20});
	}
	catch (error)  {
		self.logger.info('[ROTARYENCODER2] buttons not initialized');
	}

	self.activateRotaries([0,1])
	.then(_=> {
		self.commandRouter.pushToastMessage('success',"Rotary Encoder II - successfully loaded")
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onStart: Plugin successfully started.');				
		defer.resolve();				
	})
	.fail(error => {
		// self.commandRouter.pushToastMessage('error',"Rotary Encoder II", self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_STOP_FAIL'))
		self.logger.error('[ROTARYENCODER2] onStart: Rotarys not initialized: '+error);
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

	self.deactivateRotaries(deactivate)
	.then(_=> {
		socket.disconnect();
		self.button.unwatchAll();
		self.button.unexport();
	})
	.then(_=>{
		self.commandRouter.pushToastMessage('success',"Rotary Encoder II", self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_STOP_SUCCESS'))
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onStop: Plugin successfully stopped.');				
		defer.resolve();	
	})
	.fail(err=>{
		self.commandRouter.pushToastMessage('success',"Rotary Encoder II", self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_STOP_FAIL'))
		self.logger.error('[ROTARYENCODER2] onStop: Failed to cleanly stop plugin.');				
		defer.reject();	
	})
    return defer.promise;
};

rotaryencoder2.prototype.onRestart = function() {
    var self = this;
    var defer=libQ.defer();

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onRestart: free resources');
	// this.onStop()
	// .then(result=> defer.resolve(result))
	// .fail(err => defer.reject(err))

	// return defer.promise;
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
 
//Gets called when user saves settings from the GUI
rotaryencoder2.prototype.updateEncoder = function(data){
	var self = this;
	var defer = libQ.defer();
	var dataString = JSON.stringify(data);
	var overlayToRemove = -1

	var rotaryIndex = parseInt(dataString.match(/rotaryType([0-9])/)[1]);
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] updateEncoder: Rotary'+(rotaryIndex + 1)+'with:' + JSON.stringify(data));

	self.sanityCheckSettings(rotaryIndex, data)
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
			self.config.set('enabled'+rotaryIndex, true);	
		} else {
			self.config.set('enabled'+rotaryIndex, false);	
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

//Checks if the user settings in the GUI make sense
rotaryencoder2.prototype.sanityCheckSettings = function(rotaryIndex, data){
	var self = this;
	var defer = libQ.defer();
	var newPins = [];
	var otherPins = [];
	var allPins = [];

	// First check if the settings make sense for themselves
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] sanityCheckSettings: Rotary'+(rotaryIndex + 1)+' for:' + JSON.stringify(data));

	if (data['enabled'+rotaryIndex] == false) {
		if (self.config.get('enabled'+rotaryIndex) == true) {
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] sanityCheckSettings: Disabling rotary ' + (rotaryIndex+1) +' is OK.' );
			defer.resolve();	
		} else {
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] sanityCheckSettings: Rotary ' + (rotaryIndex+1) +' was already disabled, nothing to do.' );
			defer.resolve();	
		} 
	} else {
		//check if integer
		if (!Number.isInteger(parseInt(data['pinA'+rotaryIndex])) || !Number.isInteger(parseInt(data['pinB'+rotaryIndex])) || !Number.isInteger(parseInt(data['pinPush'+rotaryIndex]))) {
			self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_WRONG_PARAMETER'), self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_NEEDS_INTEGER'));
			defer.reject('Pin value must be integer.');
		} else {
			newPins = [parseInt(data['pinA'+rotaryIndex]),parseInt(data['pinB'+rotaryIndex]),parseInt(data['pinPush'+rotaryIndex])];
			for (let i = 0; i < maxRotaries; i++) {
				if ((!i==rotaryIndex) && (this.config.get('enabled'+i))) {
					otherPins.push(parseInt(this.config.get('pinA'+i)));
					otherPins.push(parseInt(this.config.get('pinB'+i)));
					otherPins.push(parseInt(this.config.get('pinPush'+i)));
				}
			}
			//check if duplicate number used
			if (newPins.some((item,index) => newPins.indexOf(item) != index)) {
				self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_WRONG_PARAMETER'), self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_PINS_DIFFERENT'));
				self.logger.error('[ROTARYENCODER2] sanityCheckSettings: duplicate pins. new: ' + newPins );
				defer.reject('Duplicate pin numbers provided.');
			} else {
				//check if any of the numbers used is also used in another active rotary
				allPins = [...otherPins, ...newPins];
				if (allPins.some((item,index) => allPins.indexOf(item) != index)) {
					self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_WRONG_PARAMETER'), self.commandRouter.getI18nString('ROTARYENCODER2.TOAST_PINS_BLOCKED'));
					self.logger.error('[ROTARYENCODER2] sanityCheckSettings: Pin(s) used in other rotary already.');
					defer.reject('One or more pins already used in other rotary.')
				} else {
					defer.resolve('pass');	
				}		
			}
		}				
	}
	return defer.promise;
}

//Gets called when user changes and saves debug settings
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

//Function to recursively activate all rotaries that are passed by Index in an Array
rotaryencoder2.prototype.activateRotaries = function (rotaryIndexArray) {
	var self = this;
	var defer = libQ.defer();
	var rotaryIndex;

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] activateRotaries: ' + rotaryIndexArray);

	if (Array.isArray(rotaryIndexArray)){
		if (rotaryIndexArray.length > 0) {
			rotaryIndex = rotaryIndexArray[rotaryIndexArray.length - 1];
			self.activateRotaries(rotaryIndexArray.slice(0,rotaryIndexArray.length - 1))
			.then(_=> {
				return self.addOverlay(self.config.get('pinA'+rotaryIndex),self.config.get('pinB'+rotaryIndex),self.config.get('rotaryType'+rotaryIndex))
				.then(_=>{
					return self.attachListener(self.config.get('pinA'+rotaryIndex));
				})
				.then(handle => {
					self.addEventHandle(handle, rotaryIndex)
				})		
			})
			.then(_=>{
				defer.resolve();
			})
		} else {
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] activateRotaries: end of recursion.');
			defer.resolve();
		}
	} else {
		self.logger.error('[ROTARYENCODER2] activateRotaries: rotaryIndexArray must be an Array');
		defer.reject('rotaryIndexArray must be an Array of integers')
	} 

	return defer.promise;
}

//Function to recursively deactivate all rotaries that are passed by Index in an Array
rotaryencoder2.prototype.deactivateRotaries = function (rotaryIndexArray) {
	var self = this;
	var defer = libQ.defer();
	var rotaryIndex;

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] deactivateRotaries: ' + rotaryIndexArray);

	if (Array.isArray(rotaryIndexArray)){
		if (rotaryIndexArray.length > 0) {
			rotaryIndex = rotaryIndexArray[0];
			self.deactivateRotaries(rotaryIndexArray.slice(1,rotaryIndexArray.length))
			.then(_=> {return self.detachListener(self.handles[rotaryIndex])})
			.then(_=>{ return self.checkOverlayExists(rotaryIndex)})
			.then(idx=>{return self.removeOverlay(idx)})
			.then(_=>{
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] deactivateRotaries: deactivated rotary' + (rotaryIndex + 1));
				defer.resolve();
			})
		} else {
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] deactivateRotaries: end of recursion.');
			defer.resolve();
		}
	} else {
		self.logger.error('[ROTARYENCODER2] deactivateRotaries: rotaryIndexArray must be an Array');
		defer.reject('rotaryIndexArray must be an Array of integers')
	} 
	return defer.promise;
}
rotaryencoder2.prototype.addEventHandle = function (handle, rotaryIndex) {
	var self = this; 

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] addEventHandle for rotary: ' + (rotaryIndex + 1));

	self.handles[rotaryIndex]=handle;
	self.handles[rotaryIndex].stdout.on("data", function (chunk) {
		var i=0;
		while (chunk.length - i >= 16) {
			var type = chunk.readUInt16LE(i+8)
			var value = chunk.readInt32LE(i+12)
			i += 16
			if (type == 2) {
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] addEventHandle received from rotary: '+(rotaryIndex +1) + ' -> Dir: '+value)
				self.emitCommand(value,rotaryIndex)
			} 
		}
	});

}

rotaryencoder2.prototype.emitCommand = function(value,rotaryIndex){
	var self = this;
	var action = self.config.get('dialAction'+rotaryIndex)
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] emitCommand: '+action + ' with value ' + value + 'for Rotary: '+(rotaryIndex + 1))

	switch (value) {
		case 1:
			switch (action) {
				case 1: //volume
					socket.emit('volume','+');					
					break;
			
				case 2: //skip
					socket.emit('next');				
					break;
			
				case 3: //seek
					
					break;
			
				case 4: //emit
					socket.emit(self.config.get('socketCmdCW'+rotaryIndex), self.config.get('socketDataCW'+rotaryIndex));				
					break;
			
				default:
					break;
			}
			break;
		case -1: //CCW
			switch (action) {
				case 1: //volume
					socket.emit('volume','-');					
					break;
			
				case 2: //skip
					socket.emit('prev');				
					break;
			
				case 3: //seek
					
					break;
			
				case 4: //emit
					socket.emit(self.config.get('socketCmdCCW'+rotaryIndex), self.config.get('socketDataCCW'+rotaryIndex));				
					break;
			
				default:
					break;
			}
			break;
		default:
			break;
	}
}

rotaryencoder2.prototype.addOverlay = function (pinA, pinB, stepsPerPeriod) {
	var self = this;
	var defer = libQ.defer();

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] addOverlay: ' + pinA + ' ' + pinB + ' ' + stepsPerPeriod);
	exec('/usr/bin/sudo /usr/bin/dtoverlay ' + 'rotary-encoder pin_a='+pinA+' pin_b='+pinB+' relative_axis=true steps-per-period='+stepsPerPeriod+' &', {uid: 1000, gid: 1000}, function (err, stdout, stderr) {
		if (err) {
			defer.reject(stderr);
		} else {
			defer.resolve(stdout);
		}
	})           
	return defer.promise;
}

rotaryencoder2.prototype.removeOverlay = function(idx) {
	var self = this;
	var defer = libQ.defer();
	
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] removeOverlay: ' + idx);
	if (idx > -1) {
		exec('/usr/bin/sudo /usr/bin/dtoverlay -r '+idx+' &', {uid: 1000, gid: 1000}, function (err, stdout, stderr) {
			if (err) {
				defer.reject(stderr);
			} else {
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] removeOverlay: ' + idx + ' returned: ' + stdout);
				exec('/usr/bin/sudo /usr/bin/dtoverlay -l', {uid: 1000, gid: 1000}, function (err, stdout, stderr) {
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] removeOverlay: "overlay -l" returned: ' + stdout + stderr);
					defer.resolve(stdout);			
				})
			}
		})           	
	} else {
		defer.resolve();
	}
	return defer.promise;
}

/**
 * Function looks for rotary-encoder overlays that alread use one of the provided GPIOs.
 * It returns an array with the index numbers of the overlay list returned by "dtoverlay -l"
 * If no matches are found, the returned array is empty
 * @param {Number} pin_a 
 * @param {Number} pin_b 
 * @returns Array
 */
 rotaryencoder2.prototype.checkOverlayExists = function(rotaryIndex) {
	var self = this;
	var defer = libQ.defer();
    var match;
    var overlay = -1;

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] checkOverlayExists: Checking for existing overlays for Rotary: ' + (rotaryIndex + 1));
	var pin_a = self.config.get('pinA' + rotaryIndex);
	var pin_b = self.config.get('pinB'+rotaryIndex);
    exec('/usr/bin/sudo /usr/bin/dtoverlay -l', {uid: 1000, gid: 1000}, function (err, stdout, stderr) {
        if(err) {
			self.logger.error('[ROTARYENCODER2] checkOverlayExists: Could not execute "dtoverlays -l": ' + stderr);
			defer.reject();
		}
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] checkOverlayExists: check pinA=' + pin_a + 'pinB=' + pin_b + ' in ' + stdout);
		dtoverlayRegex.lastIndex = 0;
		while (match = dtoverlayRegex.exec(stdout)) {
			if ((pin_a == match[2]) && (pin_b == match[3]))  {
				if (self.debugLogging) self.logger.info('[ROTARYENCODER2] checkOverlayExists: rotary ' + (rotaryIndex + 1) + 'uses overlay ' + match[1]);
				overlay = match[1];
				defer.resolve(overlay);
				break;
			}             
		}
    });
	return defer.promise;
}

rotaryencoder2.prototype.attachListener = function (pinA){
	var self = this;
	var defer = libQ.defer();
	var pinHex = Number(pinA).toString(16);

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] attachListener: ' + "/dev/input/by-path/platform-rotary\@"+pinHex+"-event");
	var handle = spawn("cat", ["/dev/input/by-path/platform-rotary\@"+pinHex+"-event"]);
	defer.resolve(handle);
	return defer.promise;
}

rotaryencoder2.prototype.detachListener = function (handle){
	var self = this;
	var defer = libQ.defer();
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] detachListener: ' + handle);
	handle.kill();
	defer.resolve();
	return defer.promise;
}
