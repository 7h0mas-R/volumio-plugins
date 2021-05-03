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

	self.addOverlay(17,27)
	.then(_=>self.attachListener(17))
	.then(handle => {
		self.fd1 = handle;	
		self.fd1.stdout.on("data", function (chunk) {
			var i=0,got=0
			while (chunk.length - i >= 16) {
				var s = chunk.readUInt32LE(i+0)
				var us = chunk.readUInt32LE(i+4)
				var type = chunk.readUInt16LE(i+8)
				var code = chunk.readUInt16LE(i+10)
				var value = chunk.readInt32LE(i+12)
				i += 16
				if (type == 2) {
					switch (value) {
						case 1:
							socket.emit('next');
							break;
						case -1:
							socket.emit('prev');
							break;
						default:
							break;
					}
				} 
			}
		})
	})
	// .then(_=> self.addOverlay(24,23))
	// .then(self.attachListener(24))
	// .then(handle => {
	// 	self.fd2 = handle;	
	// 	self.fd2.stdout.on("data", function (chunk) {
	// 		var i=0,got=0
	// 		while (chunk.length - i >= 16) {
	// 			var s = chunk.readUInt32LE(i+0)
	// 			var us = chunk.readUInt32LE(i+4)
	// 			var type = chunk.readUInt16LE(i+8)
	// 			var code = chunk.readUInt16LE(i+10)
	// 			var value = chunk.readInt32LE(i+12)
	// 			i += 16
	// 			if (type == 2) {
	// 				switch (value) {
	// 					case 1:
	// 						socket.emit('volume','+');
	// 						break;
	// 					case -1:
	// 						socket.emit('volume','-');
	// 						break;
	// 					default:
	// 						break;
	// 				}
	// 			} 
	// 		}
	// 	})
	// })
	.then(_=> {
		self.commandRouter.pushToastMessage('success',"Rotary Encoder II - successfully loaded")
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onStart: Plugin successfully started.');				
		defer.resolve();				
	})
	.fail(error => {
		self.logger.error('[ROTARYENCODER2] Rotary 2 not initialized: '+error);
		defer.reject();
	})

    return defer.promise;
};

rotaryencoder2.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();
	var deactivate=[];

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onStop: Stopping Plugin.');

	self.detachListener(self.fd1)
	// .then(_=>self.detachListener(self.fd2))
	.then(_=>removeOverlay(0))
	// .then(_=>removeOverlay(1))
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

rotaryencoder2.prototype.addOverlay = function (pinA, pinB, stepsPerPeriod) {
	var self = this;
	var defer = libQ.defer();
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
	exec('/usr/bin/sudo /usr/bin/dtoverlay -r '+idx+' &', {uid: 1000, gid: 1000}, function (err, stdout, stderr) {
		if (err) {
			defer.reject(stderr);
		} else {
			defer.resolve(stdout);
		}
	})           
	return defer.promise;
}

rotaryencoder2.prototype.attachListener = function (pinA){
	var self = this;
	var defer = libQ.defer();
	var pinHex = Number(pinA).toString(16);
	var handle = spawn("cat", ["/dev/input/by-path/platform-rotary\@"+pinHex+"-event"]);
	defer.resolve(handle);
	return defer.promise;
}

rotaryencoder2.prototype.detachListener = function (handle){
	var self = this;
	var defer = libQ.defer();
	handle.kill();
	defer.resolve();
	return defer.promise;
}
