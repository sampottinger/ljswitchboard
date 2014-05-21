/**
 * Goals for the Lua Script Debugger module.
 * This is a Lua script intro-app that performs a minimal number of scripting
 * operations.  It is simply capable of detecting whether or not a Lua script
 * is running and then prints out the debugging log to the window.  
 *
 * @author Chris Johnson (LabJack Corp, 2014)
 *
 * Configuration:
 * No configuration of the device is required
 *
 * Periodic Processes:
 *     1. Read from "LUA_RUN" register to determine if a Lua script is running.
 *     2. Read from "LUA_DEBUG_NUM_BYTES" register to determine how much data is
 *         available in the debugging info buffer.
 *     3. If there is data available in the debugging buffer then get it from
 *         the device. 
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
    this.DACRegisters = {};
    this.moduleContext = {};
    this.activeDevice = undefined;


    

    /**
     * Function is called once every time the module tab is selected, loads the module.
     * @param  {[type]} framework   The active framework instance.
     * @param  {[type]} onError     Function to be called if an error occurs.
     * @param  {[type]} onSuccess   Function to be called when complete.
    **/
    this.onModuleLoaded = function(framework, onError, onSuccess) {
        // device_controller.ljm_driver.writeLibrarySync('LJM_SEND_RECEIVE_TIMEOUT_MS',5000);
        // Save Module Constant objects
        self.moduleConstants = framework.moduleConstants;
        self.DACRegisters = framework.moduleConstants.DACRegisters;

        var genericConfigCallback = function(data, onSuccess) {
            console.log('genericConfigCallback');
            onSuccess();
        };
        var genericPeriodicCallback = function(data, onSuccess) {
            console.log('genericPeriodicCallback');
            onSuccess();
        };
        var genericCallback = function(data, onSuccess) {
            console.log('genericCallback');
            onSuccess();
        };
        console.log('moduleConstants', self.moduleConstants);
        var smartBindings = [];

        var addSmartBinding = function(regInfo) {
            var binding = {};
            binding.bindingName = regInfo.name;
            binding.smartName = 'readRegister';
            binding.periodicCallback = genericPeriodicCallback;
            binding.configCallback = genericConfigCallback;
            smartBindings.push(binding);
        };

        // Add DAC readRegisters
        self.DACRegisters.forEach(addSmartBinding);

        // var customSmartBindings = [
        //     {
        //         // Define binding to handle Ethernet-Status updates.
        //         bindingName: 'ethernetStatusManager', 
        //         smartName: 'periodicFunction',
        //         periodicCallback: ethernetStatusListner
        //     },{
        //         // Define binding to handle Ethernet Power button presses.
        //         bindingName: 'ethernetPowerButton', 
        //         smartName: 'clickHandler',
        //         callback: self.ethernetPowerButton
        //     },{
        //         // Define binding to handle Ethernet DHCP-select button presses.
        //         bindingName: 'ethernet-DHCP-Select-Toggle', 
        //         smartName: 'clickHandler',
        //         callback: self.ethernetDHCPSelect
        //     },{
        //         // Define binding to handle Ethernet Apply button presses.
        //         bindingName: 'ethernetApplyButton', 
        //         smartName: 'clickHandler',
        //         callback: self.ethernetApplyButton
        //     },{
        //         // Define binding to handle Ethernet Cancel button presses.
        //         bindingName: 'ethernetCancelButton', 
        //         smartName: 'clickHandler',
        //         callback: self.ethernetCancelButton
        //     },{
        //         // Define binding to handle Ethernet Cancel button presses.
        //         bindingName: 'ethernetHelpButton', 
        //         smartName: 'clickHandler',
        //         callback: self.ethernetHelpButton
        //     },{
        //         // Define binding to handle Wifi Power button presses.
        //         bindingName: 'wifiPowerButton', 
        //         smartName: 'clickHandler',
        //         callback: self.wifiPowerButton
        //     },{
        //         // Define binding to handle Wifi DHCP-select button presses.
        //         bindingName: 'wifi-DHCP-Select-Toggle', 
        //         smartName: 'clickHandler',
        //         callback: self.wifiDHCPSelect
        //     },{
        //         // Define binding to handle Wifi Apply button presses.
        //         bindingName: 'wifiApplyButton', 
        //         smartName: 'clickHandler',
        //         callback: self.wifiApplyButton
        //     },{
        //         // Define binding to handle Wifi Cancel button presses.
        //         bindingName: 'wifiCancelButton', 
        //         smartName: 'clickHandler',
        //         callback: self.wifiCancelButton
        //     },{
        //         // Define binding to handle Ethernet Cancel button presses.
        //         bindingName: 'wifiHelpButton', 
        //         smartName: 'clickHandler',
        //         callback: self.wifiHelpButton
        //     }
        // ];
        // Save the smartBindings to the framework instance.
        framework.putSmartBindings(smartBindings);
        // Save the customSmartBindings to the framework instance.
        // framework.putSmartBindings(customSmartBindings);
        onSuccess();
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

        framework.clearConfigBindings();
        framework.setStartupMessage('Waiting for Wifi Module to start');
        onSuccess();
    };

    this.onDeviceConfigured = function(framework, device, setupBindings, onError, onSuccess) {
        self.moduleContext.outputs = self.DACRegisters;
        framework.setCustomContext(self.moduleContext);
        onSuccess();
    };

    this.formatVoltageTooltip = function(value) {
        return sprintf.sprintf("%.2f V", value);
    };
    this.onVoltageSelected = function(event) {
        var selectedVoltage = Number($('#'+event.target.id).val());
        console.log('Voltage Selected',selectedVoltage);
    };
    // function onVoltageSelected(event)
    // {
    //     var register = Number(event.target.id.replace('-control', ''));
        
    //     var confirmationSelector = CONFIRMATION_DISPLAY_TEMPLATE(
    //         {register: register}
    //     );

    //     var selectedVoltage = Number($('#'+event.target.id).val());
        
    //     console.log($('#'+event.target.id).slider('getValue'));
    //     $(confirmationSelector).html(
    //         formatVoltageTooltip(selectedVoltage)
    //     );

    //     analogOutputDeviceController.setDAC(register, selectedVoltage).fail(
    //         function (err) {showAlert(err.retError);});
    // }
    /**
     * Create the DAC / analog output controls.
    **/
    this.createSliders = function()
    {
        $('.slider').slider(
            {formater: self.formatVoltageTooltip, value: 0}
        ).on('slideStop', self.onVoltageSelected);

        loadCurrentDACSettings();
    }
    this.onTemplateLoaded = function(framework, onError, onSuccess) {
        self.createSliders();
        onSuccess();
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
        // console.log('in onRefreshed',framework.moduleName);
        onSuccess();
    };
    this.onCloseDevice = function(framework, device, onError, onSuccess) {
        // self.activeDevice.setDebugFlashErr(false);
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