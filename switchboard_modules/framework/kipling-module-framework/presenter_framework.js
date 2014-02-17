/**
 * Event driven framework for easy module construction.
 *
 * @author: Chris Johnson (LabJack, 2014)
 * @author: Sam Pottinger (LabJack, 2014)
**/

var async = require('async');
var dict = require('dict');
var q = require('q');
var sprintf = require('sprintf').sprintf;

var ljmmm_parse = null;
try {
    ljmmm_parse = require('ljmmm-parse');
} catch (err) {
    console.log('error loading ljmmm_parse');
}
var fs_facade = null;
try {
    fs_facade = require('./fs_facade');
} catch (err) {
    console.log('error loading fs_facade');
}


var DEFAULT_REFRESH_RATE = 1000;
var CONFIGURING_DEVICE_TARGET = '#sd-ramework-configuring-device-display';
var DEVICE_VIEW_TARGET = '#device-view';

function JQueryWrapper (origJQuery) {
    this.html = function (selector, newHTML) {
        $(selector).html(newHTML);
    };

    this.on = function (selector, event, listener) {
        $(selector).on(event, listener);
    };

    this.find = function (selector) {
        return $(selector);
    };

    this.val = function (selector) {
        return $(selector).val();
    };
    this.hide = function(selector) {
        return $(selector).hide();
    }
    this.show = function(selector) {
        return $(selector).show();
    }
    this.fadeOut = function(selector) {
        return $(selector).fadeOut();
    }
    this.fadeIn = function(selector) {
        return $(selector).fadeIn();
    }
    this.checkFirstDeviceRadioButton = function() {
        return $('.device-selection-radio').first().prop('checked', true);
    }
    this.get = function(selector) {
        return $(selector);
    }
}


/**
 * Creates a new binding info object with the metadata copied from another.
 *
 * Creates a new binding info object, a structure with all of the information
 * necessary to bind a piece of the module GUI to a register / registers on
 * a LabJack device. This will copy the "metadata" from an existing binding
 * into a new one. Namely, it will re-use original's class, direction, and
 * event attributes but add in new binding and template values.
 * 
 * @param {Object} orginal The object with the original binding information.
 * @param {String} binding The register name to bind the GUI element(s) to.
 *      If given an LJMMM string, will be exapnded and all registers named after
 *      the expansion will be bound to the GUI. Note that this expansion
 *      is executed later in the framework and only a single binding will be
 *      returned from this function.
 * @param {String} template The template for the GUI element ID to bind. This
 *      should coorespond to a HTML element IDs. May contain LJMMM and, if
 *      given an LJMMM string, will be expanded and matched to the registers
 *      listed in binding parameter. Note that this expansion
 *      is executed later in the framework and only a single binding will be
 *      returned from this function.
 * @return {Object} New binding.
**/
function cloneBindingInfo (original, bindingClass, binding, template) {
    try{
        var retVar = {
            bindingClass: bindingClass,
            template: template,
            binding: binding,
            direction: original.direction,
            event: original.event
        };
    } catch (err) {
        console.log('ERROR: ',err);
        var retVar = {};
    }
    return retVar;
}


/**
 * Expands the LJMMM in the binding and template names.
 *
 * Each binding info object has a binding attribute with the name of the
 * register on the device to bind from as well as a template attribute that
 * specifies the ID of the HTML element to bind to. So, binding AIN0 and
 * template analog-input-0 would bind the device register for AIN0 to 
 * the HTML element with the id analog-input-0. This function will exapnd
 * LJMMM names found in either the template or binding attributes. Binding
 * AIN#(0:1) will exapnd to [AIN0, AIN1] and analog-input-#(0:1) will expand
 * to [analog-input-0, analog-input-1].
 *
 * @param {Object} bindingInfo The object with info about the binding to
 *      expand.
 * @return {Array} Array containing all of the bindings info objects that
 *      resulted from expanding the LJMMM found in original binding info
 *      object's binding and template attributes. If no LJMMM was in the
 *      original binding info object's binding or template attributes, an Array
 *      with a single binding info object will be returned.
**/
function expandBindingInfo (bindingInfo) {
    var expandedBindingClasses = ljmmm_parse.expandLJMMMName(bindingInfo.bindingClass);
    var expandedBindings = ljmmm_parse.expandLJMMMName(bindingInfo.binding);
    var expandedTemplates = ljmmm_parse.expandLJMMMName(bindingInfo.template);

    if (expandedBindings.length != expandedTemplates.length) {
        throw 'Unexpected ljmmm expansion mismatch.';
    }

    var newBindingsInfo = [];
    var numBindings = expandedBindings.length;
    for (var i=0; i<numBindings; i++) {
        var clone = cloneBindingInfo(
            bindingInfo,
            expandedBindingClasses[i],
            expandedBindings[i],
            expandedTemplates[i]
        );
        newBindingsInfo.push(clone);
    }

    return newBindingsInfo;
}

/**
 * Force a redraw on the rendering engine.
**/
function runRedraw()
{
    console.log('running runRedraw');
    document.body.style.display='none';
    document.body.offsetHeight; // no need to store this anywhere, the reference is enough
    document.body.style.display='block';
}
function qRunRedraw() {
    var innerDeferred = q.defer();
    runRedraw();
    innerDeferred.resolve
    return innerDeferred.promise; 
}


/**
 * Object that manages the modules using the Kipling Module Framework.
**/
function Framework() {

    // List of events that the framework handels
    var eventListener = dict({
        onModuleLoaded: null,
        onDeviceSelected: null,
        onTemplateLoaded: null,
        onRegisterWrite: null,
        onRegisterWritten: null,
        onRefresh: null,
        onRefreshed: null,
        onCloseDevice: null,
        onUnloadModule: null,
        onLoadError: null,
        onWriteError: null,
        onRefreshError: null,
        onExecutionError: function (params) { throw params; }
    });
    this.eventListener = eventListener;

    var jquery = null;
    var refreshRate = DEFAULT_REFRESH_RATE;
    var configControls = [];
    var bindings = dict({});
    var readBindings = dict({});
    var writeBindings = dict({});
    var selectedDevices = [];
    var userViewFile = "";
    var moduleTemplateBindings = {};
    var moduleName = '';
    var moduleJsonFiles = [];

    this.jquery = jquery;
    this.refreshRate = refreshRate;
    this.configControls = configControls;
    this.bindings = bindings;
    this.readBindings = readBindings;
    this.writeBindings = writeBindings;
    this.selectedDevices = selectedDevices;
    this.runLoop = false;
    this.userViewFile = userViewFile;
    this.moduleTemplateBindings = moduleTemplateBindings;
    this.moduleName = moduleName;
    this.moduleJsonFiles = moduleJsonFiles;

    var self = this;

    this._SetJQuery = function(newJQuery) {
        jquery = newJQuery
        this.jquery = newJQuery;
    };

    this._SetSelectedDevices = function(selectedDevices) {
        selectedDevices = selectedDevices
        self.selectedDevices = selectedDevices;
    };
    var _SetSelectedDevices = this._SetSelectedDevices;

    /**
     * Set the callback that should be called for an event.
     *
     * Indicate which function (callback) should be called when the framework
     * encounters each event. Note that previous event listeners for that event
     * will be cleared by calling this.
     *
     * @param {String} name The name of the event to register a callback for.
     * @param {function} listener The function to call when that event is
     *      encountered. Should take a single argument: an object whose
     *      attributes are parameters supplied to the event.
    **/
    this.on = function (name, listener) {
        if (!eventListener.has(name)) {
            self.fire(
                'onLoadError',
                [ 'Config binding missing direction' ],
                function (shouldContinue) { self.runLoop = shouldContinue; }
            );
            return;
        }
        eventListener.set(name, listener);
    };
    var on = this.on;

    /**
     * Force-cause an event to occur through the framework.
     *
     * @param {String} name The name of the event to fire.
     * @param {Object} params Object whose attributes should be used as
     *      parameters for the event.
     * @param {function} onErr Function to call if an error was encountered
     *      while running event listeneres. Optional.
     * @param {function} onSuccess Function to call after the event listeners
     *      finish running. Optional.
    **/
    this.fire = function (name, params, onErr, onSuccess) {
        var noop = function () {};

        if (!params)
            params = [];

        if (!onSuccess)
            onSuccess = noop;

        if (!onErr)
            onErr = noop;

        if (!eventListener.has(name)) {
            onSuccess();
            return;
        }

        var listener = eventListener.get(name);

        if (listener !== null) {
            var passParams = [];
            passParams.push(self);
            passParams.push.apply(passParams, params)
            passParams.push(onErr);
            passParams.push(onSuccess);
            listener.apply(null, passParams);
        } else {
            onSuccess();
        }
    };
    var fire = this.fire;

    this.convertBindingsToDict = function() {
        // console.log('(In: convertBindingsToDict) bindings:',self.bindings);
        // console.log('(In: convertBindingsToDict) templateData:',self.moduleTemplateBindings);
        // self.bindings.forEach(
        //     function(value, key){
        //         console.log(key + ": " + value);
        //     }
        // );
        return self.moduleTemplateBindings;
    }
    var convertBindingsToDict = this.convertBindingsToDict;

    this.qExecOnModuleLoaded = function() {
        var innerDeferred = q.defer();
        self.fire(
            'onModuleLoaded',
            [],
            innerDeferred.reject,
            innerDeferred.resolve
        );
        return innerDeferred.promise;
    }
    var qExecOnModuleLoaded = this.qExecOnModuleLoaded;

    this.qExecOnDeviceSelected = function() {
        var innerDeferred = q.defer();
        console.log('in onDeviceSelected');
        self.fire(
            'onDeviceSelected',
            [self.getSelectedDevice()],
            innerDeferred.reject,
            innerDeferred.resolve
        );
        return innerDeferred.promise;
    }
    var qExecOnDeviceSelected = this.qExecOnDeviceSelected;

    this.qExecOnTemplateLoaded = function() {
        var innerDeferred = q.defer();
        console.log('in onTemplateLoaded');
        self.fire(
            'onTemplateLoaded',
            [],
            innerDeferred.reject,
            innerDeferred.resolve
        );
        return innerDeferred.promise;
    }
    var qExecOnTemplateLoaded = this.qExecOnTemplateLoaded;

    this.qExecOnCloseDevice = function(device) {
        var innerDeferred = q.defer();
        self.fire(
            'onCloseDevice',
            [device],
            innerDeferred.reject,
            innerDeferred.resolve
        );
        return innerDeferred.promise;
    }
    var qExecOnCloseDevice = this.qExecOnCloseDevice;

    this.qExecOnLoadError = function(err) {
        var innerDeferred = q.defer();
        self.fire(
            'onLoadError',
            [
                [ err ],
                function (shouldContinue) { 
                    self.runLoop = shouldContinue; 
                    innerDeferred.resolve();
                }
            ]
        );
        return innerDeferred.promise;
    }
    var qExecOnLoadError = this.qExecOnLoadError;

    this.qExecOnUnloadModule = function(err) {
        self.stopLoop();

        var innerDeferred = q.defer();
        self.fire(
            'onUnloadModule',
            [],
            innerDeferred.reject,
            innerDeferred.resolve
        );
        return innerDeferred.promise;
    }
    var qExecOnUnloadModule = this.qExecOnUnloadModule;

    this.qRenderModuleTemplate = function() {
        var innerDeferred = q.defer();
        self.setDeviceView(
            self.userViewFile,
            //['thermocouple_simple/moduleData.json'],
            self.moduleJsonFiles,
            self.convertBindingsToDict(), 
            innerDeferred.reject, 
            innerDeferred.resolve
        );
        return innerDeferred.promise;
    }
    var qRenderModuleTemplate = this.qRenderModuleTemplate;

    this.qUpdateActiveDevice = function() {
        var innerDeferred = q.defer();
        var keeper = device_controller.getDeviceKeeper();
        var devices = keeper.getDevices();
        var selectedDevices = [];

        self.jquery.get('.device-selection-radio:checked').each(
            function (index, elem) {
                var numDevices = devices.length;
                var serial = elem.id.replace('-selector', '');
                for (var i=0; i<numDevices; i++) {
                    if (devices[i].getSerial() === serial)
                        selectedDevices.push(devices[i]);
                }
                return null;
            }
        );

        self._SetSelectedDevices(selectedDevices);
        innerDeferred.resolve();
        return innerDeferred.promise;
    }
    var qUpdateActiveDevice = this.qUpdateActiveDevice;

    /**
     * Set how frequently the framework should read from the device.
     *
     * @param {int} newRefreshRate The number of milliseconds between updates.
    **/
    this.setRefreshRate = function (newRefreshRate) {
        self.refreshRate = newRefreshRate;
    };
    var setRefreshRate = this.setRefreshRate;

    /**
     * Indicate which HTML controls should cause device configured to fire.
     *
     * Indicate which HTML controls (not bound through putConfigBinding) that
     * should cause a device configured event to be fired when they have an
     * event within the HTML view. This could, for example, be a button to
     * write values to a device.
     *
     * @param {Array} newConfigControls An array of Object where each element
     *      has an event attribute with the name of the event to listen for
     *      on the HTML element and a selector attribute which should be a 
     *      jQuery selector for the HTML elements to bind the event listener
     *      to.
    **/
    this.setConfigControls = function (newConfigControls) {
        self.configControls = newConfigControls;
    };
    var setConfigControls = this.setConfigControls;

    /**
     * Register a new configuration binding.
     *
     * Register a new configuration binding that either cuases an HTML element
     * to act as a (frequently updated) display for the value of a register
     * or as an HTML element that allows the user to write the value of
     * a device register. This device binding info object should have
     * attributes:
     *
     * <ul>
     *   <li>{string} class: Description of what type of binding this is. Not
     *          used in this first release of this framework.</li>
     *   <li>{string} template: The ID of the HTML element to bind to. For
     *          example: ain-0-display or ain-#(0:1)-display.</li>
     *   <li>{string} binding: The name of the device register to bind to. For
     *          exmaple: AIN0 or AIN#(0:1).</li>
     *   <li>{string} direction: Either "read" for displaying a the value of a
     *          device register or "write" for having an HTML element set the
     *          value of a device register. May also be "hybrid" which will
     *          first read the current value of a register, display that, and
     *          then update the value of that register on subsequent updates
     *          from within the view.</li>
     *   <li>{string} event: The name of the event to bind to. Only required if
     *          write or hybrid. For example, "change" would cause the value to
     *          be written to the device each time an input box value is
     *          changed.</li>
     * </ul>
     *
     * Note that template and binding can contain LJMMM strings. If they do,
     * they will automagically be expanded and bound individually. So, template
     * of analog-#(0:1)-display and binding of AIN#(0:1) will bind
     * analog-0-display to AIN0 and analog-1-display to AIN1.
     *
     * @param {Object} newBinding The binding information object (as described
     *      above) that should be registered.
    **/
    this.putConfigBinding = function (newBinding) {
        var onErrorHandle = function (shouldContinue) {
            self.runLoop = shouldContinue;
        }

        if (newBinding['bindingClass'] === undefined) {
            self.fire(
                'onLoadError',
                [ 'Config binding missing bindingClass' ],
                onErrorHandle
            );
            return;
        }
        // if (newBinding['templateKey'] === undefined) {
        //     self.fire(
        //         'onLoadError',
        //         [ 'Config binding missing templateKey' ],
        //         onErrorHandle
        //     );
        //     return;
        // }

        if (newBinding['template'] === undefined) {
            self.fire(
                'onLoadError',
                [ 'Config binding missing template' ],
                onErrorHandle
            );
            return;
        }        

        if (newBinding['binding'] === undefined) {
            self.fire(
                'onLoadError',
                [ 'Config binding missing binding' ],
                onErrorHandle
            );
            return;
        }

        if (newBinding['direction'] === undefined) {
            self.fire(
                'onLoadError',
                [ 'Config binding missing direction' ],
                onErrorHandle
            );
            return;
        }

        var isWrite = newBinding['direction'] === 'write';
        if (isWrite && newBinding['event'] === undefined) {
            self.fire(
                'onLoadError',
                [ 'Config binding missing direction' ],
                onErrorHandle
            );
            return;
        }

        var expandedBindings = expandBindingInfo(newBinding);
        var numBindings = expandedBindings.length;
        if (numBindings > 1) {
            for (var i=0; i<numBindings; i++)
                putConfigBinding(expandedBindings[i]);
            return;
        }

        try{
            if(self.moduleTemplateBindings[newBinding.bindingClass] === undefined) {
                self.moduleTemplateBindings[newBinding.bindingClass] = [];
            }
            self.moduleTemplateBindings[newBinding.bindingClass].push(newBinding);
        } catch (err) {
            console.log('here');
        }
        bindings.set(newBinding.template, newBinding);
        

        var jquerySelector = '#' + newBinding.template;
        if (newBinding.direction === 'read') {
            readBindings.set(newBinding.template, newBinding);
        } else if (newBinding.direction === 'write') {
            writeBindings.set(newBinding.template, newBinding);
            jquery.on(
                jquerySelector,
                newBinding.event,
                function () { self._writeToDevice(newBinding); }
            );
        } else {
            self.fire(
                'onLoadError',
                [ 'Config binding has invalid direction' ],
                onErrorHandle
            );
        }
    };
    var putConfigBinding = this.putConfigBinding;

    this.putConfigBindings = function(bindings) {
        var numBindings = bindings.length;
        for(var i = 0; i < numBindings; i++) {
            self.putConfigBinding(bindings[i]);
        }
    }
    var putConfigBindings = this.putConfigBindings;

    this._writeToDevice = function (bindingInfo) {
        var jquerySelector = '#' + bindingInfo.template;
        var newVal = self.jquery.val(jquerySelector);

        var alertRegisterWrite = function () {
            var innerDeferred = q.defer();
            self.fire(
                'onRegisterWrite',
                [
                    bindingInfo,
                    newVal
                ],
                innerDeferred.reject,
                innerDeferred.resolve
            );
            return innerDeferred.promise;
        };

        var writeToDevice = function (skipWrite) {
            var innerDeferred = q.defer();
            var device = self.getSelectedDevice();
            if(bindingInfo.binding.split('-').length == 2) {
                if(bindingInfo.binding.split('-')[1] === 'invalid') {
                    innerDeferred.resolve(false);
                    return innerDeferred.promise;
                }
            }
            if(typeof(skipWrite) === undefined) {
                device.write(bindingInfo.binding, newVal);
                innerDeferred.resolve(true);
            } else if(typeof(skipWrite) === "boolean") {
                if(skipWrite == false) {
                    device.write(bindingInfo.binding, newVal);
                    innerDeferred.resolve(true);
                }
                else {
                    innerDeferred.resolve(false);
                }
            } else {
                innerDeferred.resolve(false);
            }
            return innerDeferred.promise;
        }

        var alertRegisterWritten = function (wasNotHandledExternally) {
            if(wasNotHandledExternally) {
                var innerDeferred = q.defer();
                self.fire(
                    'onRegisterWritten',
                    [
                        bindingInfo.binding,
                        newVal
                    ],
                    innerDeferred.reject,
                    innerDeferred.resolve
                );
                return innerDeferred.promise;
            }
        };

        var deferred = q.defer();
        alertRegisterWrite()
        .then(writeToDevice, deferred.reject)
        .then(alertRegisterWritten, deferred.reject)
        .then(deferred.resolve, deferred.reject);
    }

    /**
     * Delete a previously added configuration binding.
     *
     * @param {String} bindingName The name of the binding (the binding info
     *      object's original "template" attribute) to delete.
    **/
    this.deleteConfigBinding = function (bindingName) {
        var expandedBindings = ljmmm_parse.expandLJMMMName(bindingName);
        var numBindings = expandedBindings.length;
        if (numBindings > 1) {
            for (var i=0; i<numBindings; i++)
                deleteConfigBinding(expandedBindings[i]);
            return;
        }

        if (!self.bindings.has(bindingName)) {
            self.fire(
                'onLoadError',
                [ 'No binding for ' + bindingName ],
                function (shouldContinue) { self.runLoop = shouldContinue; }
            );
            return;
        }

        var bindingInfo = this.bindings.get(bindingName);

        self.bindings.delete(bindingName);

        if (bindingInfo.direction === 'read') {
            self.readBindings.delete(bindingName);
        } else if (bindingInfo.direction === 'write') {
            self.writeBindings.delete(bindingName);
            var jquerySelector = '#' + bindingInfo.template;
            jquery.off(jquerySelector, bindingInfo.event);
        } else {
            self.fire(
                'onLoadError',
                [ 'Config binding has invalid direction' ],
                function (shouldContinue) { self.runLoop = shouldContinue; }
            );
        }
    };
    var deleteConfigBinding = this.deleteConfigBinding;

    /**
     * Render the HTML view to use for the current module.
     *
     * @param {str} templateLoc Path to the HTML template to use to render this
     *      module's view. Will be rendered as a handlebars template.
     * @param {Array} jsonFiles String paths to the JSON files to use when
     *      rendering this view. Will be provided to the template as an
     *      attribute "json" on the rendering context. Namely, context.json will
     *      be set to an object where the attribute is the name of the JSON file
     *      and the value is the JSON loaded from that file.
     * @param {function} onErr The function to call if an error was encountered
     *      while rendering the module view. Optional.
     * @param {function} onSuccess The function to call after the view has been
     *      rendered.
    **/
    this.setDeviceView = function (loc, jsonFiles, context, onErr, onSuccess) {
        var noop = function () {};

        if (jsonFiles === undefined)
            jsonFiles = [];

        if (context === undefined)
            context = {};

        if (!onErr)
            onErr = noop;

        if (!onSuccess)
            onSuccess = noop;
        // console.log('context (analogInputs)', context);
        // console.log('moduleTemplateBindings:', self.moduleTemplateBindings);

        // Create an error handler
        var reportLoadError = function (details) {
            console.log('reporting load error', details);
            onErr({'msg': details});
            self.fire(
                'onLoadError',
                [ details ],
                function (shouldContinue) { self.runLoop = shouldContinue; }
            );
        };

        // Load the supporting JSON files for use in the template
        var jsonTemplateVals = {};
        var loadJSONFiles = function () {
            var deferred = q.defer();
            async.eachSeries(
                jsonFiles,
                function (location, callback) {
                    var fullURI = fs_facade.getExternalURI(location);
                    fs_facade.getJSON(
                        fullURI,
                        callback,
                        function (result) {
                            var lName = location.replace(/\.json/g, '');
                            var name = lName.split('/')[lName.split('/').length-1];
                            jsonTemplateVals[name] = result;
                            callback(null); 
                        }
                    );
                },
                function (err) {
                    if (err)
                        deferred.reject(err);
                    else
                        deferred.resolve();
                }
            );
            return deferred.promise;
        };

        // Load the HTML view template and render
        var prepareHTMLTemplate = function () {
            var deferred = q.defer();
            var fullURI = fs_facade.getExternalURI(loc);
            context.json = jsonTemplateVals;
            fs_facade.renderTemplate(
                fullURI,
                context,
                deferred.reject,
                deferred.resolve
            );
            return deferred.promise;
        };

        this.introduceDelay = function() {
            console.log('introduceDelay');
            var innerDeferred = q.defer();
            setTimeout(innerDeferred.resolve, 200);
            return innerDeferred.promise;
        }
        this.forceRefresh = function() {
            console.log('forceRefresh');
            var innerDeferred = q.defer();
            runRedraw();
            innerDeferred.resolve();
            return innerDeferred.promise;
        }

        var injectHTMLTemplate = function (htmlContents) {
            console.log('injectHTMLTemplate');
            var deferred = q.defer();
            // var moduleDiv = $(DEVICE_VIEW_TARGET);
            // moduleDiv.html(htmlContents);
            
            htmlContents = '<div class="framework-template">' + htmlContents + '</div>';
            self.jquery.html(DEVICE_VIEW_TARGET, htmlContents);
            $('.framework-template').ready(runRedraw);

            deferred.resolve();
            return deferred.promise;
        };

        var attachListeners = function () {
            console.log('attachListeners');
            self.jquery.on(
                '.device-selection-radio',
                'click',
                self._changeSelectedDeviceUI
            );
            self.jquery.find('.device-selection-radio').first().prop(
                'checked', true);
        };

        loadJSONFiles()
        .then(prepareHTMLTemplate, reportLoadError)
        .then(injectHTMLTemplate, reportLoadError)
        //.then(introduceDelay, reportLoadError)
        //.then(forceRefresh, reportLoadError)
        .then(attachListeners, reportLoadError)
        .then(onSuccess, reportLoadError);
    };
    var setDeviceView = self.setDeviceView;

    this._changeSelectedDeviceUI = function () {
        var deferred = q.defer();
        var selectedCheckboxes = $('.device-selection-radio:checked');

        // hide users module & display the loading screen while the new device
        // is configured
        self.jquery.fadeOut(DEVICE_VIEW_TARGET);
        //self.jquery.fadein(CONFIGURING_DEVICE_TARGET);

        var showUserTemplate = function() {
            //self.jquery.fadeout(CONFIGURING_DEVICE_TARGET);
            self.jquery.fadeIn(DEVICE_VIEW_TARGET);
        }

        //Perform necessary actions
        self.qExecOnCloseDevice(self.getSelectedDevice())
        .then(self.qUpdateActiveDevice, self.qExecOnLoadError)
        .then(self.qExecOnDeviceSelected, self.qExecOnLoadError)
        .then(showUserTemplate, self.qExecOnLoadError)
        .then(self.qExecOnTemplateLoaded, self.qExecOnLoadError)
        .then(deferred.resolve, deferred.reject);

        return deferred.promise;
    };

    /**
     * Get the currently selected device.
     *
     * @return {presenter.Device} The device selected as the "active" device.
    **/
    this.getSelectedDevice = function () {
        if (self.selectedDevices.length == 0)
            return null;
        else
            return self.selectedDevices[0];
    };
    var getSelectedDevice = this.getSelectedDevice;

    /**
     * Function that should be called after all of the bindings have been added.
     *
     * Function that should be called after all of the config bindings have been
     * added and all of the config controls have been set.
    **/
    this.establishConfigControlBindings = function () {
        var listener = self._OnConfigControlEvent;
        var jquery = self.jquery;
        self.configControls.forEach(function (value) {
            jquery.on(value.selector, value.event, listener);
        });
    };
    var establishConfigControlBindings = this.establishConfigControlBindings;

    /**
     * Stop the module's refresh loop.
    **/
    this.stopLoop = function () {
        self.runLoop = false;
    };
    var stopLoop = this.stopLoop;

    /**
     * Start the module's refresh loop.
    **/
    this.startLoop = function () {
        self.runLoop = true;
        self.loopIteration();
    };
    var startLoop = this.startLoop;

    this.qConfigureTimer = function() {
        var innerDeferred = q.defer();
        setTimeout(self.loopIteration, self.refreshRate);
        innerDeferred.resolve();
        return innerDeferred.promise;
    }
    var qConfigureTimer = this.qConfigureTimer;
    /**
     * Function to run a single iteration of the module's refresh loop.
     *
     * @return {q.promise} Promise that resolves after the iteration of the
     *      refresh loop finishes running. Rejects if an error was encountered
     *      during the loop iteration.
    **/
    this.loopIteration = function () {
        var deferred = q.defer();

        if (!self.runLoop) {
            deferred.reject('Loop not running.');
            return deferred.promise;
        }

        var reportError = function (details) {
            // TODO: Get register names from readBindings.
            self.fire(
                'onRefreshError',
                [ self.readBindings , details ],
                function (shouldContinue) { self.runLoop = shouldContinue; }
            );
            deferred.reject(details);
        };

        var getNeededAddresses = function () {
            var innerDeferred = q.defer();
            var addresses = [];
            var formats = [];

            self.readBindings.forEach(function (value, key) {
                addresses.push(value.binding);
                if (value.format)
                    formats.push(value.format);
                else
                    formats.push('%.4f');
            });

            innerDeferred.resolve({addresses: addresses, formats: formats});
            return innerDeferred.promise;
        };

        var alertRefresh = function (bindingsInfo) {
            var innerDeferred = q.defer();
            self.fire(
                'onRefresh',
                [ bindingsInfo ],
                innerDeferred.reject,
                function () { innerDeferred.resolve(bindingsInfo); }
            );
            return innerDeferred.promise;
        };
        var checkModuleStatus = function(bindingsInfo) {
            var innerDeferred = q.defer();
            if(self.moduleName === getActiveTabID()) {
                innerDeferred.resolve(bindingsInfo);
            } else {
                innerDeferred.reject(bindingsInfo);
            }
            return innerDeferred.promise;
        }

        var requestDeviceValues = function (bindingsInfo) {
            var innerDeferred = q.defer();
            var device = self.getSelectedDevice();
            var addresses = bindingsInfo.addresses;
            var formats = bindingsInfo.formats;
            
            if (addresses.length == 0) {
                innerDeferred.resolve({
                    values: [],
                    addresses: [],
                    formats: []
                });
                return innerDeferred.promise;
            }

            device.readMany(addresses)
            .then(
                function (values) {
                    innerDeferred.resolve({
                        values: values,
                        addresses: addresses,
                        formats: formats
                    });
                },
                innerDeferred.reject
            );

            return innerDeferred.promise;
        };

        var processDeviceValues = function (valuesInfo) {
            var innerDeferred = q.defer();
            var values = valuesInfo.values;
            var addresses = valuesInfo.addresses;
            var formats = valuesInfo.formats;
            var numAddresses = addresses.length;
            var retDict = dict();

            for (var i=0; i<numAddresses; i++) {
                retDict.set(
                    addresses[i].toString(),
                    sprintf(formats[i], values[i])
                );
            }

            innerDeferred.resolve(retDict);
            return innerDeferred.promise;
        };

        var alertOn = function (valuesDict) {
            var innerDeferred = q.defer();
            self._OnRead(valuesDict);
            innerDeferred.resolve(valuesDict);
            return innerDeferred.promise;
        };

        var alertRefreshed = function (valuesDict) {
            var innerDeferred = q.defer();
            self.fire(
                'onRefreshed',
                [ valuesDict ],
                innerDeferred.reject,
                function () { innerDeferred.resolve(); }
            );
            return innerDeferred.promise;
        };

        // var setTimeout = function () {
            
        // };
        //checkModuleStatus()
        getNeededAddresses()
        .then(alertRefresh, reportError)
        .then(requestDeviceValues, reportError)
        .then(processDeviceValues, reportError)
        .then(alertOn, reportError)
        .then(alertRefreshed, reportError)
        .then(checkModuleStatus, reportError)
        .then(self.qConfigureTimer, self.qExecOnUnloadModule)
        .then(deferred.resolve, deferred.reject);

        return deferred.promise;
    };
    var loopIteration = this.loopIteration;

    /**
     * Determine how many bindings have been registered for the module.
     *
     * @return {int} The number of bindings registered for this module.
    **/
    this.numBindings = function () {
        return self.bindings.size();
    };
    var numBindings = this.numBindings;

    this._OnRead = function (valueReadFromDevice) {
        var jquery = self.jquery;
        self.readBindings.forEach(function (bindingInfo, template) {
            var bindingName = bindingInfo.binding;
            var valRead = valueReadFromDevice.get(bindingName.toString());
            if (valRead !== undefined) {
                var jquerySelector = '#' + bindingInfo.template;
                jquery.html(jquerySelector, valRead);
            }
        });
    };
    var _OnRead = _OnRead;

    this._OnConfigControlEvent = function (event) {
        self.fire('onRegisterWrite', [event]);
        self.fire('onRegisterWritten', [event]);
    };
    var _OnConfigControlEvent = _OnConfigControlEvent;

    this.configFramework = function(viewLoc) {
        userViewFile = viewLoc;
        self.userViewFile = viewLoc;
        //self.fire('onModuleLoaded')
    };
    this.configureFrameworkData = function(jsonDataFiles) {
        moduleJsonFiles = jsonDataFiles;
        self.moduleJsonFiles = jsonDataFiles;
    };
    var configureFrameworkData = this.configureFrameworkData;

    this.saveModuleName = function() {
        moduleName = getActiveTabID();
        self.moduleName = getActiveTabID();
    };
    var saveModuleName = this.saveModuleName;

    this.setCustomContext = function(data) {
        moduleTemplateBindings['custom'] = data;
        self.moduleTemplateBindings['custom'] = data;
    }
    var setCustomContext = this.setCustomContext;

    this.tabClickHandler = function() {
        var visibleTabs = self.jquery.get('.module-tab');
        visibleTabs.off('click.sdFramework'+self.moduleName);
        self.qExecOnUnloadModule();
    }
    var tabClickHandler = this.tabClickHandler;

    this.attachNavListeners = function() {
        var visibleTabs = self.jquery.get('.module-tab');
        visibleTabs.on('click.sdFramework'+getActiveTabID(),self.tabClickHandler);
    }
    var attachNavListeners = this.attachNavListeners;

    this.startFramework = function() {
        var deferred = q.defer();
        
        self.qExecOnModuleLoaded()
        .then(self.attachNavListeners, self.qExecOnLoadError)
        .then(deferred.resolve, deferred.reject);
        return deferred.promise;
    };

    this.runFramework = function() {
        var deferred = q.defer();
        var handleError = function(details) {
            var innerDeferred = q.defer();
            console.log('Presenter_Framework, runFramework Error:', details);
            deferred.reject(details);
            innerDeferred.resolve();
            return innerDeferred.promise;
        }
        var displayModuleTemplate = function() {
            var innerDeferred = q.defer();
            self.jquery.fadeOut(CONFIGURING_DEVICE_TARGET);
            self.jquery.fadeIn(DEVICE_VIEW_TARGET);
            innerDeferred.resolve();
            return innerDeferred.promise;
        }
        var checkFirstDevice = function() {
            var innerDeferred = q.defer();
            self.jquery.checkFirstDeviceRadioButton();
            innerDeferred.resolve();
            return innerDeferred.promise;
        }
        var setModuleName = function() {
            var innerDeferred = q.defer();
            self.saveModuleName();
            innerDeferred.resolve();
            return innerDeferred.promise;
        }
        
        checkFirstDevice()
        .then(setModuleName, self.qExecOnLoadError)
        .then(self.qUpdateActiveDevice, self.qExecOnLoadError)
        .then(self.qExecOnDeviceSelected, self.qExecOnLoadError)
        .then(self.qRenderModuleTemplate, self.qExecOnLoadError)
        .then(displayModuleTemplate, self.qExecOnLoadError)
        .then(self.qExecOnTemplateLoaded, self.qExecOnLoadError)
        .then(self.startLoop, self.qExecOnLoadError)
        .then(qRunRedraw, self.qExecOnLoadError)
        .then(deferred.resolve, deferred.reject);
        return deferred.promise;
    }
}

var singleDeviceFramework = Framework;
try {
    exports.Framework = Framework
} catch (err) {
    console.log('error defining presenter_framework.js exports', err);  
}

// console.log('initializing framework & module');
// Initialize the framework
var sdFramework = new Framework();