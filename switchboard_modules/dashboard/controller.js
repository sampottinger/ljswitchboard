/**
 * Goals for the dashboard module.
 * To replace the current device_overview module with inline-edit options &
 * read the current device values w/o modifying the devices current state. 
 *
 * @author Chris Johnson (LabJack Corp, 2014)
 * @author Sam Pottinger (LabJack Corp, 2013)
 *
 * Configuration:
 * No configuration of the device is required
 *
 * Periodic Processes:
 *     1. Read from AIN(0:13) to update analog input channels
 *     2. Read from DAC(0:1) to update DAC outputs (if device gets changed via 
 *         script or other user)
 *     3. Read FIO/EIO/CIO/MIO_STATE and FIO/EIO/CIO/MIO_DIRECTION bit masks to
 *         update/display dio channels
**/

// Constant that determines device polling rate.  Use an increased rate to aid
// in user experience.
var MODULE_UPDATE_PERIOD_MS = 1000;

// Constant that can be set to disable auto-linking the module to the framework
var DISABLE_AUTOMATIC_FRAMEWORK_LINKAGE = false;

/**
 * Module object that gets automatically instantiated & linked to the appropriate framework.
 * When using the 'singleDevice' framework it is instantiated as sdModule.
 */
function module() {
    this.moduleConstants = {};
    this.REGISTER_OVERLAY_SPEC = {};
    this.startupRegList = {};
    this.interpretRegisters = {};
    this.startupRegListDict = dict();

    this.moduleContext = {};
    this.activeDevice = undefined;
    this.deviceInfo = {
        type: '',
        version: '',
        fullType: ''
    }

    this.currentValues = dict();
    this.newBufferedValues = dict();
    this.bufferedOutputValues = dict();

    this.deviceDashboardController = undefined;

    
    this.roundReadings = function(reading) {
        return Math.round(reading*1000)/1000;
    };
    this.writeReg = function(address,value) {
        var ioDeferred = q.defer();
        self.activeDevice.qWrite(address,value)
        .then(function(){
            self.bufferedOutputValues.set(address,value);
            ioDeferred.resolve();
        },function(err){
            // console.error('fail',address,err);
            ioDeferred.reject(err);
        });
        return ioDeferred.promise;
    };
    /**
     * Function is called once every time the module tab is selected, loads the module.
     * @param  {[type]} framework   The active framework instance.
     * @param  {[type]} onError     Function to be called if an error occurs.
     * @param  {[type]} onSuccess   Function to be called when complete.
    **/
    this.onModuleLoaded = function(framework, onError, onSuccess) {
        console.log('in onModuleLoaded');
        // device_controller.ljm_driver.writeLibrarySync('LJM_SEND_RECEIVE_TIMEOUT_MS',5000);
        // Save Module Constant objects
        self.moduleConstants = framework.moduleConstants;
        self.startupRegList = framework.moduleConstants.startupRegList;
        self.interpretRegisters = framework.moduleConstants.interpretRegisters;
        self.REGISTER_OVERLAY_SPEC = framework.moduleConstants.REGISTER_OVERLAY_SPEC;
        
        var genericConfigCallback = function(data, onSuccess) {
            onSuccess();
        };
        var genericPeriodicCallback = function(data, onSuccess) {
            var name = data.binding.binding;
            // var value = self.roundReadings(data.value);
            var value = data.value;
            var oldValue = self.currentValues.get(name);
            if(oldValue != value) {
                self.newBufferedValues.set(name,value);
            } else {
                self.newBufferedValues.delete(name);
            }
            onSuccess();
        };

        // console.log('moduleConstants', self.moduleConstants);
        var smartBindings = [];
        var addSmartBinding = function(regInfo) {
            var binding = {};
            binding.bindingName = regInfo.name;
            if(regInfo.isPeriodic && regInfo.isConfig){
                // Add to list of config & periodicically read registers
                binding.smartName = 'readRegister';
                binding.periodicCallback = genericPeriodicCallback;
            } else if ((!regInfo.isPeriodic) && regInfo.isConfig) {
                // Add to list of config registers
                binding.smartName = 'setupOnlyRegister';
            }
            binding.configCallback = genericConfigCallback;
            smartBindings.push(binding);
            
        };

        // Add general readRegisters
        self.startupRegList.forEach(addSmartBinding);

        // Save the smartBindings to the framework instance.
        framework.putSmartBindings(smartBindings);
        // Save the customSmartBindings to the framework instance.
        // framework.putSmartBindings(customSmartBindings);

        self.createProcessConfigStatesAndDirections();
        // onSuccess();
    };

    this.expandLJMMMNameSync = function (name) {
        return ljmmm_parse.expandLJMMMEntrySync(
            {name: name, address: 0, type: 'FLOAT32'}
        ).map(function (entry) { return entry.name; });
    };

    this.createProcessConfigStatesAndDirections = function () {
        var registersByDirectionReg = dict();
        var registersByStateReg = dict();
        var registersToExpand;
        var expandedRegisters;

        registersToExpand = self.interpretRegisters.filter(function (reg) {
            return reg.stateReg;
        });

        expandedRegisters = registersToExpand.map(function (reg) {
            var names = self.expandLJMMMNameSync(reg.name);
            var regList;
            
            // Set up a mapping by the state reg
            regList = registersByStateReg.get(reg.stateReg, []);
            regList = regList.concat(names.map(function (name, index) {
                return {
                    name: name,
                    stateReg: reg.stateReg,
                    directionReg: reg.directionReg,
                    index: index
                };
            }));
            registersByStateReg.set(reg.stateReg, regList);

            // Set up a mapping by the direction reg
            regList = registersByDirectionReg.get(reg.directionReg, []);
            regList = regList.concat(names.map(function (name, index) {
                return {
                    name: name,
                    stateReg: reg.stateReg,
                    directionReg: reg.directionReg,
                    index: index
                };
            }));
            registersByDirectionReg.set(reg.directionReg, regList);
        });

        var handleStates = function (states, address, viewRegInfoDict) {
            var registers = registersByStateReg.get(address, []);
            registers.forEach(function (register) {
                var state = states >> register.index & 0x1;
                var viewRegInfo = viewRegInfoDict.get(register.name, {});
                viewRegInfo.state = state;
                viewRegInfo.type = 'dynamic';
                viewRegInfoDict.set(register.name, viewRegInfo);
            });
        };

        var handleDirections = function (directions, address, viewRegInfoDict) {
            var registers = registersByDirectionReg.get(address, []);
            registers.forEach(function (register) {
                var direction = directions >> register.index & 0x1;
                var viewRegInfo = viewRegInfoDict.get(register.name, {});
                viewRegInfo.direction = direction;
                viewRegInfoDict.set(register.name, viewRegInfo);
            });
        };

        var handleOther = function (value, address, viewRegInfoDict) {
            var viewRegInfo = viewRegInfoDict.get(address, {});
            viewRegInfo.value = value;
            if(address.indexOf('DAC') !== -1) {
                viewRegInfo.type = 'analogOutput';
            } else {
                viewRegInfo.type = 'analogInput';
            }
            viewRegInfoDict.set(address, viewRegInfo);
        };

        var hasText = function (haystack, needle) {
            return haystack.indexOf(needle) != -1;
        };

        self.processConfigStatesAndDirections = function (registers,
            onSuccess) {
            var viewRegInfoDict = dict();
            registers.forEach(function (regValue, regAddress) {
                if (hasText(regAddress, 'STATE')) {
                    handleStates(regValue, regAddress, viewRegInfoDict);
                } else if (hasText(regAddress, 'DIRECTION')) {
                    handleDirections(regValue, regAddress, viewRegInfoDict);
                } else {
                    handleOther(regValue, regAddress, viewRegInfoDict);
                }
            });
            onSuccess(viewRegInfoDict);
        };
    };
    
    /**
     * Function is called once every time a user selects a new device.  
     * @param  {[type]} framework   The active framework instance.
     * @param  {[type]} device      The active framework instance.
     * @param  {[type]} onError     Function to be called if an error occurs.
     * @param  {[type]} onSuccess   Function to be called when complete.
    **/
    this.onDeviceSelected = function(framework, device, onError, onSuccess) {
        console.log('in onDeviceSelected');
        self.activeDevice = device;
        var dt = device.getDeviceType();
        var ds = device.getSubclass();
        self.deviceInfo.type = dt;
        self.deviceInfo.subclass = ds;
        if(self.deviceInfo.subclass !== '') {
            self.deviceInfo.fullType = dt + '-' + ds;
        } else {
            self.deviceInfo.fullType = dt;
        }


        framework.clearConfigBindings();
        framework.setStartupMessage('Reading Device Configuration');

        // Get new deviceDashboardController instance
        self.deviceDashboardController = new getDeviceDashboardController(self.deviceInfo);
        // Load file resources required for deviceDashboardController
        self.deviceDashboardController.loadResources(onSuccess);

        onSuccess();
    };
    this.onDeviceConfigured = function(framework, device, setupBindings, onError, onSuccess) {
        console.log('in onDeviceConfigured');
        setupBindings.forEach(function(setupBinding){
            var name = setupBinding.address;
            var value;
            if(setupBinding.status === 'error') {
                value = 0;
            } else {
                value = self.roundReadings(setupBinding.result);
            }
            self.currentValues.set(name,value);
        });
        onSuccess();
    };

    this.formatVoltageTooltip = function(value) {
        return sprintf.sprintf("%.2f V", value);
    };
    this.writeSpinner = function(spinner,value) {
        if(value < 0) {
            value = 0;
        }
        if(typeof(value) !== 'undefined') {
            spinner.val(value.toFixed(3));
        }
    }
    this.writeDisplayedVoltage = function(register, selectedVoltage) {
        var devEl = $('#' + register + '-device_input_spinner');
        var dbEl = $('#' + register + '_input_spinner');
        self.writeSpinner(devEl,selectedVoltage);
        self.writeSpinner(dbEl,selectedVoltage);
    };

        // var firingID = event.target.id;
        // var selectedVoltage;
        // var isValidValue = false;
        // var register = firingID
        //     .replace('_input_spinner', '')
        //     .replace('_input_slider', '');

        // if (firingID.search('_input_spinner') > 0) {
        //     var spinText = $('#'+firingID).val();
        //     if(spinText !== null) {
        //         isValidValue = (spinText !== null && spinText.match(/[\d]+(\.\d+)?$/g) !== null);
        //         selectedVoltage = Number(spinText);
        //     }
        // }
        // if(isValidValue) {
        //     console.log('newVal',typeof(selectedVoltage),selectedVoltage,register);
        //     $('#'+register+'_input_spinner').css('border', 'none');
        //     self.writeDisplayedVoltage(register,selectedVoltage);
        // } else {
        //     if (firingID.search('_input_spinner') > 0) {
        //         var spinText = $('#'+firingID).val();
        //         if (spinText !== null && !spinText.match(/\d+\./g)) {
        //             $('#'+register+'_input_spinner').css('border', '1px solid red');
        //         }
        //     }
        // }
    this.dacListerners = {
        'DAC0-device_input_spinner':    {type:'',   timer:null, reg: 'DAC0'},
        'DAC1-device_input_spinner':    {type:'',   timer:null, reg: 'DAC1'},
        'DAC0_input_spinner':           {type:'',   timer:null, reg: 'DAC0'},
        'DAC1_input_spinner':           {type:'',   timer:null, reg: 'DAC1'}
    };
    this.setVoltage = function(event,id,element) {
        var setFunc = function() {
            var type = self.dacListerners[id].type;
            var isWrite = false;
            if (type === 'scroll') {
                element.blur();
                isWrite = true;
            } else if (type === 'enterButton') {
                element.blur();
                isWrite = true;
            } else if (type === 'focusLeft') {
                isWrite = true;
            } else if (type === 'increment') {
                element.blur();
                isWrite = true;
            }
            if(isWrite) {
                var val = element.spinner('value');
                var reg = self.dacListerners[id].reg;
                if(typeof(val) === 'number') {
                    if (val < 0) {
                        val = 0;
                    } else if (val > 5) {
                        val = 5;
                    }
                    self.writeSpinner(element,val);
                    self.writeReg(reg,val)
                    .then(function() {
                        console.log('onSuccess!');
                    }, function(err) {
                        console.log('Error...',err);
                    });
                } else {
                    self.writeSpinner(element,self.currentValues.get(reg));
                }
                self.dacListerners[id].type = '';
            }
        };
        return setFunc;
    };
    this.onVoltageSelectedSpinStop = function(event) {
        if(typeof(event.currentTarget) !== 'undefined') {
            var targetID = event.currentTarget.id;
            var targetElement = $('#'+targetID);
            if(typeof(self.dacListerners[targetID]) !== 'undefined') {
                clearTimeout(self.dacListerners[targetID].timer);
                self.dacListerners[targetID].timer = setTimeout(
                    self.setVoltage(event,targetID,targetElement), 
                    500
                );
                self.spinStopData = event;
            } else {
                var targetElement = event.currentTarget.parentElement.children[0];
                var targetID = targetElement.id;
                var targetObject = $('#'+targetID);
                self.dacListerners[targetID].type = 'increment';
                clearTimeout(self.dacListerners[targetID].timer);
                // Enable this code for timeed blur events for up/down arrows
                self.dacListerners[targetID].timer = setTimeout(
                    self.setVoltage(targetElement,targetID,targetObject), 
                    500
                );
                // Enable this code for immediate writes to up/down arrows
                // self.setVoltage(targetElement,targetID,targetObject)();
            }
        }
    };
    this.onVoltageSelectedSpin = function(event) {
        if(typeof(event.currentTarget) !== 'undefined') {
            var targetID = event.currentTarget.id;
            // console.log('id',targetID,event.currentTarget);
            if(typeof(self.dacListerners[targetID]) !== 'undefined') {
                self.dacListerners[targetID].type = 'scroll';
                self.spinData = event;
            } else {
                var targetElement = event.currentTarget.parentElement.children[0];
                var targetID = targetElement.id;
                self.dacListerners[targetID].type = 'increment';
                self.spinData = $('#'+targetID);
            }
        }
    };
    this.onVoltageSelectedChange = function(event) {
        if(typeof(event.currentTarget) !== 'undefined') {
            var targetID = event.currentTarget.id;
            var targetElement = $('#'+targetID)
            var isFocused = targetElement.is(":focus");
            if(self.dacListerners[targetID].type !== 'scroll') {
                if(self.dacListerners[targetID].type !== 'enterButton') {
                    clearTimeout(self.dacListerners[targetID].timer);
                    if(!isFocused) {
                        self.dacListerners[targetID].type = 'focusLeft';
                        self.setVoltage(event,targetID,targetElement)();
                    }
                }
            }
        }
    };
    this.handleKeypress = function(event) {
        var code = event.keyCode || event.which;
        var targetID = event.currentTarget.id;
        self.dacListerners[targetID].type = 'keyPress';
        clearTimeout(self.dacListerners[targetID].timer);
        if(code == 13) { //Enter keycode
            var targetElement = $('#'+targetID);
            self.dacListerners[targetID].type = 'enterButton';
            clearTimeout(self.dacListerners[targetID].timer);
            self.setVoltage(event,targetID,targetElement)();
        }
    };
    
    this.createSpinners = function() {
        $( ".spinner" ).unbind();
        $( ".spinner" ).spinner({
            'step': 0.001,
            'numberFormat': "n",
            'max': 5,
            'min': 0,
            'change': self.onVoltageSelectedChange,
            'spin': self.onVoltageSelectedSpin,
            'stop': self.onVoltageSelectedSpinStop
        });
        $( ".spinner" ).bind('keypress', self.handleKeypress);
    };
    this.isStringIn = function(baseStr, findStr) {
        return baseStr.indexOf(findStr) !== -1;
    };
    this.dioChangeListner = function(event) {
        self.dioEvent = event;
        var className = event.toElement.className;
        var baseEl = event.toElement;
        if (self.isStringIn(className, 'menuOption')) {
            var parentEl = baseEl.parentElement.parentElement.parentElement;
            var id = parentEl.id;
            var parentObj = $('#'+parentEl.parentElement.id);
            console.log('parentObj',parentObj);
            var strVal = baseEl.innerHTML;
            var val = baseEl.attributes.value.value;
            var splitEls = id.split('-');
            var activeReg = splitEls[0];
            var selectType = splitEls[1];
            if(selectType === 'device') {
                selectType = splitEls[2];
            }
            if (selectType === 'DIRECTION') {
                var curValObj = $('#'+id).find('.currentValue');
                var curDirection = {
                    'Input':0,
                    'Output':1
                }[curValObj.text()];
                if(curDirection != val) {
                    //Update GUI & write/read values to device
                    curValObj.text(strVal);
                    var inputDisplayId = '.digitalDisplayIndicator';
                    var outputDisplayId = '.digitalStateSelectButton';
                    var outObj = parentObj.find(outputDisplayId);
                    var inObj = parentObj.find(inputDisplayId);
                    // Switch to perform either a read (if channel is becoming 
                    // an input) or a write (if channel is becoming an output)
                    if(Number(val) === 0) {
                        outObj.hide();
                        inObj.show();
                        // Perform device read
                        self.activeDevice.qRead(activeReg)
                        .then(function(val) {
                            // Update GUI with read value
                            var inputStateId = '.digitalDisplayIndicator .currentValue';
                            var inputStateObj = parentObj.find(inputStateId);
                            var state = {
                                '0': {'status': 'inactive', 'text': 'Low'},
                                '1': {'status': 'active', 'text': 'High'}
                            }[val.toString()];
                            inputStateObj.removeClass('active inactive')
                            .addClass(state.status);
                            inputStateObj.html(state.text);
                        },function(err) {
                            console.error('Error Reading',activeReg,err);
                        });
                    } else {
                        inObj.hide();
                        outObj.show();
                        var outputStateId = '.digitalStateSelectButton .currentValue';
                        var outputStateObj = parentObj.find(outputStateId);
                        outputStateObj.html('High');

                        // Perform device write, force to be high at start
                        self.writeReg(activeReg,1)
                        .then(function() {
                        },function(err) {
                            console.error('Error Writing to',activeReg,err);
                        });
                    }
                }
            } else if (selectType === 'STATE') {
                var curValueObj = $('#'+id).find('.currentValue');
                // Object to interpret text to device numbers
                var curState = {
                    'Low':0,
                    'High':1
                }[curValueObj.text()];
                if(curState != val) {
                    //Update GUI
                    curValueObj.text(strVal);

                    // Perform device write with user selected value
                    self.writeReg(activeReg,Number(val))
                    .then(function() {
                    },function(err) {
                        console.error('Error Setting State of',activeReg,err);
                    });
                }
            }
        } else if (self.isStringIn(className, 'toggleButton')) {
            var parentEl = baseEl.parentElement;
            var id = parentEl.id;
            var activeReg = id.split('-')[0];
            var location = id.split('-')[1];
            var registerName = activeReg;
            if(location === 'device') {
                registerName += location;
            }
            var curStr = baseEl.innerHTML;
            //Set to opposite of actual to toggle the IO line
            var newVal = {'High':0,'Low':1}[curStr];
            var newStr = {'Low':'High','High':'Low'}[curStr];
            var outputDisplayId = '#' + registerName + '-STATE-SELECT .currentValue';
            
            // Update GUI
            $(outputDisplayId).text(newStr);

            // Perform device write with the opposite value that is currently 
            // displayed by the gui, to "toggle" the output state
            self.writeReg(activeReg,Number(newVal))
            .then(function() {
            },function(err) {
                console.error('Error Toggling State of',activeReg,err);
            });
        }
    };
    this.attachDIOListners = function() {
        var digitalObj = $('.digitalControlObject');
        digitalObj.unbind();
        digitalObj.bind('click', self.dioChangeListner);
    };
    this.onTemplateLoaded = function(framework, onError, onSuccess) {
        console.log('in onTemplateLoaded');
        onSuccess();
    };
    this.onTemplateDisplayed = function(framework, onError, onSuccess) {
        console.log('in onTemplateDisplayed');
        self.processConfigStatesAndDirections(self.currentValues, function(initializedData){
            self.deviceDashboardController.drawDevice('#device-display-container',initializedData);
            self.deviceDashboardController.drawDBs('#db-display-container', initializedData);
            self.createSpinners();
            var regs = ['DAC0','DAC1'];
            regs.forEach(function(reg){
                var setV = self.currentValues.get(reg);
                self.writeDisplayedVoltage(reg,setV);
            });
            self.attachDIOListners();
            onSuccess();
        });
    };
    this.onRegisterWrite = function(framework, binding, value, onError, onSuccess) {
        // console.log('in onRegisterWrite',binding);
        onSuccess();
    };
    this.onRegisterWritten = function(framework, registerName, value, onError, onSuccess) {
        onSuccess();
    };
    this.onRefresh = function(framework, registerNames, onError, onSuccess) {
        // console.log('in onRefresh',framework.moduleName);
        onSuccess();
    };
    this.onRefreshed = function(framework, results, onError, onSuccess) {
        var extraData = dict();
        // Save buffered output values to the dict.
        self.bufferedOutputValues.forEach(function(value,name){
            self.currentValues.set(name,value);
            self.bufferedOutputValues.delete(name);
        });

        // Check to see if any _STATE or _DIRECTION bit masks have changed.  If
        // so add their counterpart as a later function needs all relevant
        // information.
        self.newBufferedValues.forEach(function(value,name){
            if(name.indexOf('_STATE') > 0) {
                var getName = name.split('_STATE')[0] + '_DIRECTION';
                var getVal = self.currentValues.get(getName);
                extraData.set(getName,getVal);
            } else if(name.indexOf('_DIRECTION') > 0) {
                var getName = name.split('_DIRECTION')[0] + '_STATE';
                var getVal = self.currentValues.get(getName);
                extraData.set(getName,getVal);
            }
        });
        // Only add the counterpart-data if it isn't already there
        extraData.forEach(function(value,name){
            if(!self.newBufferedValues.has(name)) {
                self.newBufferedValues.set(name,value);
            }
        });

        // Execute function that expands all read bit-mask registers into 
        // individually indexed (by register name) objects.  Also intelligently 
        // combines data by channel for convenience.
        self.processConfigStatesAndDirections(self.newBufferedValues, function(newData){
            self.deviceDashboardController.updateValues(newData,self.currentValues);

            //Delete Changed Values & update last-saved device values
            self.newBufferedValues.forEach(function(value,name){
                self.currentValues.set(name,value);
                self.newBufferedValues.delete(name);
            });
            onSuccess();
        });
    };
    this.onCloseDevice = function(framework, device, onError, onSuccess) {
        // self.activeDevice.setDebugFlashErr(false);
        try {
            delete self.deviceDashboardController;
            self.deviceDashboardController = undefined;
            $('#dashboard').remove();
        } catch (err) {
            console.log('Error Deleting Data',err);
        }
        onSuccess();
    };
    this.onUnloadModule = function(framework, onError, onSuccess) {
        onSuccess();
    };
    this.onLoadError = function(framework, description, onHandle) {
        console.log('in onLoadError', description);
        onHandle(true);
    };
    this.onWriteError = function(framework, registerName, value, description, onHandle) {
        console.log('in onConfigError', description);
        onHandle(true);
    };
    this.onRefreshError = function(framework, registerNames, description, onHandle) {
        console.log('in onRefreshError', description);
        if(typeof(description.retError) === 'number') {
            console.log('in onRefreshError',device_controller.ljm_driver.errToStrSync(description.retError));
        } else {
            console.log('Type of error',typeof(description.retError),description.retError);
        }
        onHandle(true);
    };

    var self = this;
}
