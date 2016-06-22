// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Rsvg = imports.gi.Rsvg;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const GDesktopEnums = imports.gi.GDesktopEnums;
const Atk = imports.gi.Atk;
const Cairo = imports.cairo;
const Signals = imports.signals;

const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Layout = imports.ui.layout;

const ACTIVE_COLOR = "#729fcf";

const LTR = 0;
const RTL = 1;

const CW = 0;
const CCW = 1;

const UP = 0;
const DOWN = 1;

const KeybindingEntry = new Lang.Class({
    Name: 'KeybindingEntry',

    _init: function () {
        this.actor = new St.Entry({ hint_text: _("New shortcut…"),
                                    style: 'width: 10em' });
        this.actor.connect('captured-event', Lang.bind(this, this._onCapturedEvent));
    },

    _onCapturedEvent: function (actor, event) {
        if (event.type() != Clutter.EventType.KEY_PRESS)
            return Clutter.EVENT_PROPAGATE;

        let str = Gtk.accelerator_name_with_keycode(null,
                                                    event.get_key_symbol(),
                                                    event.get_key_code(),
                                                    event.get_state());
        this.actor.set_text(str);
        this.emit('keybinding-edited', str);
        return Clutter.EVENT_STOP;
    }
});
Signals.addSignalMethods(KeybindingEntry.prototype);

const ActionComboBox = new Lang.Class({
    Name: 'ActionComboBox',

    _init: function () {
        this.actor = new St.Button({ style_class: 'button' });
        this.actor.connect('clicked', Lang.bind(this, this._onButtonClicked));
        this.actor.set_toggle_mode(true);

        let boxLayout = new Clutter.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL,
                                                spacing: 6 });
        let box = new St.Widget({ layout_manager: boxLayout });
        this.actor.set_child(box);

        this._label = new St.Label({ style_class: 'combo-box-label' });
        box.add_child(this._label)

        let arrow = new St.Icon({ style_class: 'popup-menu-arrow',
                                  icon_name: 'pan-down-symbolic',
                                  accessible_role: Atk.Role.ARROW,
                                  y_expand: true,
                                  y_align: Clutter.ActorAlign.CENTER });
        box.add_child(arrow);

        this._editMenu = new PopupMenu.PopupMenu(this.actor, 0, St.Side.TOP);
        this._editMenu.connect('menu-closed', Lang.bind(this, function() { this.actor.set_checked(false); }));
        this._editMenu.actor.hide();
        Main.uiGroup.add_actor(this._editMenu.actor);

        this._actionLabels = new Map();
        this._actionLabels.set(GDesktopEnums.PadButtonAction.NONE, _("Application defined"));
        this._actionLabels.set(GDesktopEnums.PadButtonAction.HELP, _("Show on-screen help"));
        this._actionLabels.set(GDesktopEnums.PadButtonAction.SWITCH_MONITOR, _("Switch monitor"));
        this._actionLabels.set(GDesktopEnums.PadButtonAction.KEYBINDING, _("Assign keystroke"));

        for (let [action, label] of this._actionLabels.entries()) {
            let selectedAction = action;
            this._editMenu.addAction(label, Lang.bind(this, function() { this._onActionSelected(selectedAction) }));
        }

        this.setAction(GDesktopEnums.PadButtonAction.NONE);
    },

    _onActionSelected: function (action) {
        this.setAction(action);
        this.popdown();
        this.emit('action-selected', action);
    },

    setAction: function (action) {
        this._label.set_text(this._actionLabels.get(action));
    },

    popup: function () {
        this._editMenu.open(true);
    },

    popdown: function () {
        this._editMenu.close(true);
    },

    _onButtonClicked: function () {
        if (this.actor.get_checked())
            this.popup();
        else
            this.popdown();
    }
});
Signals.addSignalMethods(ActionComboBox.prototype);

const ActionEditor = new Lang.Class({
    Name: 'ActionEditor',

    _init: function () {
        let boxLayout = new Clutter.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL,
                                                spacing: 12 });

        this.actor = new St.Widget({ layout_manager: boxLayout });

        this._actionComboBox = new ActionComboBox();
        this._actionComboBox.connect('action-selected', Lang.bind(this, this._onActionSelected));
        this.actor.add_actor(this._actionComboBox.actor);

        this._keybindingEdit = new KeybindingEntry();
        this._keybindingEdit.connect('keybinding-edited', Lang.bind(this, this._onKeybindingEdited));
        this.actor.add_actor(this._keybindingEdit.actor);

        this._doneButton = new St.Button({ label: _("Done"),
                                           style_class: 'button',
                                           x_expand: false});
        this._doneButton.connect('clicked', Lang.bind(this, this._onEditingDone));
        this.actor.add_actor(this._doneButton);
    },

    _updateKeybindingEntryState: function () {
        if (this._currentAction == GDesktopEnums.PadButtonAction.KEYBINDING) {
            this._keybindingEdit.actor.set_text(this._currentKeybinding);
            this._keybindingEdit.actor.show();
            this._keybindingEdit.actor.grab_key_focus();
        } else {
            this._keybindingEdit.actor.hide();
        }
    },

    setSettings: function (settings) {
        this._buttonSettings = settings;

        this._currentAction = this._buttonSettings.get_enum('action');
        this._currentKeybinding = this._buttonSettings.get_string('keybinding');
        this._actionComboBox.setAction(this._currentAction);
        this._updateKeybindingEntryState();
    },

    close: function() {
        this._actionComboBox.popdown();
        this.actor.hide();
    },

    _onKeybindingEdited: function (entry, keybinding) {
        this._currentKeybinding = keybinding;
    },

    _onActionSelected: function (menu, action) {
        this._currentAction = action;
        this._updateKeybindingEntryState();
    },

    _storeSettings: function () {
        if (!this._buttonSettings)
            return;

        let keybinding = null;

        if (this._currentAction == GDesktopEnums.PadButtonAction.KEYBINDING)
            keybinding = this._currentKeybinding;

        this._buttonSettings.set_enum('action', this._currentAction);

        if (keybinding)
            this._buttonSettings.set_string('keybinding', keybinding);
        else
            this._buttonSettings.reset('keybinding');
    },

    _onEditingDone: function () {
        this._storeSettings();
        this.close();
        this.emit('done');
    }
});
Signals.addSignalMethods(ActionEditor.prototype);

const PadDiagram = new Lang.Class({
    Name: 'PadDiagram',
    Extends: St.DrawingArea,
    Properties: { 'left-handed': GObject.ParamSpec.boolean('left-handed',
                                                           'left-handed', 'Left handed',
                                                           GObject.ParamFlags.READWRITE |
                                                           GObject.ParamFlags.CONSTRUCT_ONLY,
                                                           false),
                  'image': GObject.ParamSpec.string('image', 'image', 'Image',
                                                    GObject.ParamFlags.READWRITE |
                                                    GObject.ParamFlags.CONSTRUCT_ONLY,
                                                    null),
                  'editor-actor': GObject.ParamSpec.object('editor-actor',
                                                           'editor-actor',
                                                           'Editor actor',
                                                           GObject.ParamFlags.READWRITE |
                                                           GObject.ParamFlags.CONSTRUCT_ONLY,
                                                           Clutter.Actor.$gtype) },

    _init: function (params) {
        let file = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/pad-osd.css');
        let [success, css, etag] = file.load_contents(null);
        this._css = css;
        this._labels = [];
        this._activeButtons = [];
        this.parent(params);
    },

    get left_handed() {
        return this._leftHanded;
    },

    set left_handed(leftHanded) {
        this._leftHanded = leftHanded;
    },

    get image() {
        return this._imagePath;
    },

    set image(imagePath) {
        let originalHandle = Rsvg.Handle.new_from_file(imagePath);
        let dimensions = originalHandle.get_dimensions();
        this._imageWidth = dimensions.width;
        this._imageHeight = dimensions.height;

        this._imagePath = imagePath;
        this._handle = this._composeStyledDiagram();
    },

    get editor_actor() {
        return this._editorActor;
    },

    set editor_actor(actor) {
        actor.hide();
        this._editorActor = actor;
        this.add_actor(actor);
    },

    _wrappingSvgHeader: function () {
        return ('<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
                '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" ' +
                'xmlns:xi="http://www.w3.org/2001/XInclude" ' +
                'width="' + this._imageWidth + '" height="' + this._imageHeight + '"> ' +
                '<style type="text/css">');
    },

    _wrappingSvgFooter: function () {
        return ('</style>' +
                '<xi:include href="' + this._imagePath + '" />' +
                '</svg>');
    },

    _cssString: function () {
        let css = this._css;

        for (let i = 0; i < this._activeButtons.length; i++) {
            let ch = String.fromCharCode('A'.charCodeAt() + this._activeButtons[i]);
            css += ('.' + ch + ' { ' +
	            '  stroke: ' + ACTIVE_COLOR + ' !important; ' +
                    '  fill: ' + ACTIVE_COLOR + ' !important; ' +
                    '} ');
        }

        return css;
    },

    _composeStyledDiagram: function () {
        let svgData = '';

        if (!GLib.file_test(this._imagePath, GLib.FileTest.EXISTS))
            return null;

        svgData += this._wrappingSvgHeader();
        svgData += this._cssString();
        svgData += this._wrappingSvgFooter();

        let handle = new Rsvg.Handle();
        handle.set_base_uri(GLib.path_get_dirname(this._imagePath));
        handle.write(svgData);
        handle.close();

        return handle;
    },

    _updateDiagramScale: function () {
        if (this._handle == null)
            return;

        [this._actorWidth, this._actorHeight] = this.get_size();
        let dimensions = this._handle.get_dimensions();
        let scaleX = this._actorWidth / dimensions.width;
        let scaleY = this._actorHeight / dimensions.height;
        this._scale = Math.min(scaleX, scaleY);
    },

    _allocateChild: function (child, x, y, direction) {
        let [prefHeight, natHeight] = child.get_preferred_height(-1);
        let [prefWidth, natWidth] = child.get_preferred_width(natHeight);
        let childBox = new Clutter.ActorBox();

        if (direction == LTR) {
            childBox.x1 = x;
            childBox.x2 = x + natWidth;
        } else {
            childBox.x1 = x - natWidth;
            childBox.x2 = x;
        }

        childBox.y1 = y - natHeight / 2;
        childBox.y2 = y + natHeight / 2;
        child.allocate(childBox, 0);
    },

    vfunc_allocate: function (box, flags) {
        this.parent(box, flags);
        this._updateDiagramScale();

        for (let i = 0; i < this._labels.length; i++) {
            let [label, action, idx, dir] = this._labels[i];
            let [found, x, y, arrangement] = this.getLabelCoords(action, idx, dir);
            this._allocateChild(label, x, y, arrangement);
        }

        if (this._editorActor && this._curEdited) {
            let [label, action, idx, dir] = this._curEdited;
            let [found, x, y, arrangement] = this.getLabelCoords(action, idx, dir);
            this._allocateChild(this._editorActor, x, y, arrangement);
        }
    },

    vfunc_repaint: function () {
        if (this._handle == null)
            return;

        if (this._scale == null)
            this._updateDiagramScale();

        let [width, height] = this.get_surface_size();
        let dimensions = this._handle.get_dimensions();
        let cr = this.get_context();

        cr.save();
        cr.translate(width/2, height/2);
        cr.scale(this._scale, this._scale);
        if (this._leftHanded)
            cr.rotate(Math.PI);
        cr.translate(-dimensions.width/2, -dimensions.height/2);
        this._handle.render_cairo(cr);
        cr.restore();
        cr.$dispose();
    },

    _transformPoint: function (x, y) {
        if (this._handle == null || this._scale == null)
            return [x, y];

        // I miss Cairo.Matrix
        let dimensions = this._handle.get_dimensions();
        x = x * this._scale + this._actorWidth / 2 - dimensions.width / 2 * this._scale;
        y = y * this._scale + this._actorHeight / 2 - dimensions.height / 2 * this._scale;;
        return [Math.round(x), Math.round(y)];
    },

    _getItemLabelCoords: function (labelName, leaderName) {
        if (this._handle == null)
            return [false];

        let leaderPos, leaderSize, pos;
        let found, direction;

        [found, pos] = this._handle.get_position_sub('#' + labelName);
        if (!found)
            return [false];

        [found, leaderPos] = this._handle.get_position_sub('#' + leaderName);
        [found, leaderSize] = this._handle.get_dimensions_sub('#' + leaderName);
        if (!found)
            return [false];

        if (pos.x > leaderPos.x + leaderSize.width)
            direction = LTR;
        else
            direction = RTL;

        if (this._leftHanded) {
            direction = 1 - direction;
            pos.x = this._imageWidth - pos.x;
            pos.y = this._imageHeight - pos.y;
        }

        let [x, y] = this._transformPoint(pos.x, pos.y)

        return [true, x, y, direction];
    },

    getButtonLabelCoords: function (button) {
        let ch = String.fromCharCode('A'.charCodeAt() + button);
        let labelName = 'Label' + ch;
        let leaderName = 'Leader' + ch;

        return this._getItemLabelCoords(labelName, leaderName);
    },

    getRingLabelCoords: function (number, dir) {
        let numStr = number > 0 ? number.toString() : '';
        let dirStr = dir == CW ? 'CW' : 'CCW';
        let labelName = 'LabelRing' + numStr + dirStr;
        let leaderName = 'LeaderRing' + numStr + dirStr;

        return this._getItemLabelCoords(labelName, leaderName);
    },

    getStripLabelCoords: function (number, dir) {
        let numStr = number > 0 ? (number + 1).toString() : '';
        let dirStr = dir == UP ? 'Up' : 'Down';
        let labelName = 'LabelStrip' + numStr + dirStr;
        let leaderName = 'LeaderStrip' + numStr + dirStr;

        return this._getItemLabelCoords(labelName, leaderName);
    },

    getLabelCoords: function (action, idx, dir) {
        if (action == Meta.PadActionType.BUTTON)
            return this.getButtonLabelCoords(idx);
        else if (action == Meta.PadActionType.RING)
            return this.getRingLabelCoords(idx, dir);
        else if (action == Meta.PadActionType.STRIP)
            return this.getStripLabelCoords(idx, dir);

        return [false];
    },

    _invalidateSvg: function () {
        if (this._handle == null)
            return;
        this._handle = this._composeStyledDiagram();
        this.queue_repaint();
    },

    activateButton: function (button) {
        this._activeButtons.push(button);
        this._invalidateSvg();
    },

    deactivateButton: function (button) {
        for (let i = 0; i < this._activeButtons.length; i++) {
            if (this._activeButtons[i] == button)
                this._activeButtons.splice(i, 1);
        }
        this._invalidateSvg();
    },

    addLabel: function (label, type, idx, dir) {
        this._labels.push([label, type, idx, dir]);
        this.add_actor(label);
    },

    stopEdition: function (str) {
        this._editorActor.hide();

        if (this._curEdited) {
            let [label, action, idx, dir] = this._curEdited;
            if (str != null) {
                label.set_text(str);

                let [found, x, y, arrangement] = this.getLabelCoords(action, idx, dir);
                this._allocateChild(label, x, y, arrangement);
            }
            label.show();
            this._curEdited = null;
        }
    },

    startEdition: function(action, idx, dir) {
        let editedLabel;
        this.stopEdition();

        for (let i = 0; i < this._labels.length; i++) {
            let [label, itemAction, itemIdx, itemDir] = this._labels[i];
            if (action == itemAction && idx == itemIdx && dir == itemDir) {
                this._curEdited = this._labels[i];
                editedLabel = label;
                break;
            }
        }

        if (this._curEdited == null)
            return;
        let [found] = this.getLabelCoords(action, idx, dir);
        if (!found)
            return;
        this._editorActor.show();
        editedLabel.hide();
    }
});

const PadOsd = new Lang.Class({
    Name: 'PadOsd',

    _init: function (padDevice, settings, imagePath, editionMode, monitorIndex) {
        this.padDevice = padDevice;
        this._settings = settings;
        this._imagePath = imagePath;
        this._editionMode = editionMode;
        this._capturedEventId = global.stage.connect('captured-event', Lang.bind(this, this._onCapturedEvent));

        let deviceManager = Clutter.DeviceManager.get_default();
        this._deviceRemovedId = deviceManager.connect('device-removed', Lang.bind(this, function (manager, device) {
            // If the device is being removed, destroy the padOsd.
            if (device == this.padDevice)
                this.destroy();
        }));

        this.actor = new St.BoxLayout({ style_class: 'pad-osd-window',
                                        x_expand: true,
                                        y_expand: true,
                                        vertical: true,
                                        reactive: true });
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        Main.uiGroup.add_actor(this.actor);

        this._monitorIndex = monitorIndex;
        let constraint = new Layout.MonitorConstraint({ index: monitorIndex });
        this.actor.add_constraint(constraint);

        this._titleLabel = new St.Label({ style: 'font-side: larger; font-weight: bold;',
                                          x_align: Clutter.ActorAlign.CENTER });
        this._titleLabel.clutter_text.set_text(padDevice.get_device_name());
        this.actor.add_actor(this._titleLabel);

        this._tipLabel = new St.Label({ x_align: Clutter.ActorAlign.CENTER });
        this.actor.add_actor(this._tipLabel);

        this._actionEditor = new ActionEditor();
        this._actionEditor.connect('done', Lang.bind(this, this._endButtonActionEdition));

        this._padDiagram = new PadDiagram({ image: this._imagePath,
                                            left_handed: settings.get_boolean('left-handed'),
                                            editor_actor: this._actionEditor.actor,
                                            x_expand: true,
                                            y_expand: true });
        this.actor.add_actor(this._padDiagram);

        // FIXME: Fix num buttons.
        let i = 0;
        for (i = 0; i < 50; i++) {
            let [found] = this._padDiagram.getButtonLabelCoords(i);
            if (!found)
                break;
            this._createLabel(Meta.PadActionType.BUTTON, i);
        }

        for (i = 0; i < padDevice.get_n_rings(); i++) {
            this._createLabel(Meta.PadActionType.RING, i, CW);
            this._createLabel(Meta.PadActionType.RING, i, CCW);
        }

        for (i = 0; i < padDevice.get_n_strips(); i++) {
            this._createLabel(Meta.PadActionType.STRIP, i, UP);
            this._createLabel(Meta.PadActionType.STRIP, i, DOWN);
        }

        let buttonBox = new St.Widget({ layout_manager: new Clutter.BinLayout(),
                                         x_expand: true,
                                         x_align: Clutter.ActorAlign.CENTER,
                                         y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_actor(buttonBox);
        this._editButton = new St.Button({ label: _("Edit…"),
                                           style_class: 'button',
                                           x_align: Clutter.ActorAlign.CENTER,
                                           can_focus: true });
        this._editButton.connect('clicked', Lang.bind(this, function () { this.setEditionMode(true) }));
        buttonBox.add_actor(this._editButton);

        this._syncEditionMode();
        Main.pushModal(this.actor);
    },

    _createLabel: function (type, number, dir) {
        let str = global.display.get_pad_action_label(this.padDevice, type, number);
        let label = new St.Label({ text: str ? str : _("None") });
        this._padDiagram.addLabel(label, type, number, dir);
    },

    _onCapturedEvent : function (actor, event) {
        if (event.type() == Clutter.EventType.PAD_BUTTON_PRESS &&
            event.get_source_device() == this.padDevice) {
            this._padDiagram.activateButton(event.get_button());

            if (this._editionMode)
                this._startButtonActionEdition(event.get_button());
            return Clutter.EVENT_STOP;
        } else if (event.type() == Clutter.EventType.PAD_BUTTON_RELEASE &&
                   event.get_source_device() == this.padDevice) {
            this._padDiagram.deactivateButton(event.get_button());
            return Clutter.EVENT_STOP;
        } else if (event.type() == Clutter.EventType.KEY_PRESS &&
                   (!this._editionMode || event.get_key_symbol() == Clutter.Escape)) {
            if (this._editingButtonAction != null)
                this._endButtonActionEdition();
            else
                this.destroy();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    },

    _syncEditionMode: function () {
        this._editButton.set_reactive(!this._editionMode);
        this._editButton.save_easing_state();
        this._editButton.set_easing_duration(200);
        this._editButton.set_opacity(this._editionMode ? 128 : 255);
        this._editButton.restore_easing_state();

        let title;

        if (this._editionMode) {
            title = _("Press a button to configure");
            this._tipLabel.set_text(_("Press Esc to exit"));
        } else {
            title = this.padDevice.get_device_name();
            this._tipLabel.set_text(_("Press any key to exit"));
        }

        this._titleLabel.clutter_text.set_markup('<span size="larger"><b>' + title + '</b></span>');
    },

    _endButtonActionEdition: function () {
        this._actionEditor.close();

        if (this._editingButtonAction != null) {
            let str = global.display.get_pad_action_label(this.padDevice,
                                                          Meta.PadActionType.BUTTON,
                                                          this._editingButtonAction);
            this._padDiagram.stopEdition(str ? str : _("None"))
            this._editingButtonAction = null;
        }

        this._editedButtonSettings = null;
    },

    _startButtonActionEdition: function (button) {
        if (this._editingButtonAction == button)
            return;

        this._endButtonActionEdition();
        this._editingButtonAction = button;

        let ch = String.fromCharCode('A'.charCodeAt() + button);
        let settingsPath = this._settings.path + "button" + ch + '/';
        this._editedButtonSettings = Gio.Settings.new_with_path('org.gnome.desktop.peripherals.tablet.pad-button',
                                                                settingsPath);
        this._actionEditor.setSettings(this._editedButtonSettings);
        this._padDiagram.startEdition(Meta.PadActionType.BUTTON, button);
    },

    setEditionMode: function (editionMode) {
        if (this._editionMode == editionMode)
            return;

        this._editionMode = editionMode;
        this._syncEditionMode();
    },

    destroy: function () {
        this.actor.destroy();
    },

    _onDestroy: function () {
        Main.popModal(this.actor);
        this._actionEditor.close();

        if (this._deviceRemovedId != 0) {
            let deviceManager = Clutter.DeviceManager.get_default();
            deviceManager.disconnect(this._deviceRemovedId);
            this._deviceRemovedId = 0;
        }

        if (this._capturedEventId != 0) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }

        this.actor = null;
        this.emit('closed');
    }
});
Signals.addSignalMethods(PadOsd.prototype);

const PadOsdIface = '<node> \
<interface name="org.gnome.Shell.Wacom.PadOsd"> \
<method name="Show"> \
    <arg name="device_node" direction="in" type="o"/> \
    <arg name="edition_mode" direction="in" type="b"/> \
</method> \
</interface> \
</node>';

const PadOsdService = new Lang.Class({
    Name: 'PadOsdService',

    _init: function() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(PadOsdIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell/Wacom');
        Gio.DBus.session.own_name('org.gnome.Shell.Wacom.PadOsd', Gio.BusNameOwnerFlags.REPLACE, null, null);
    },

    ShowAsync: function(params, invocation) {
        let [deviceNode, editionMode] = params;
        let deviceManager = Clutter.DeviceManager.get_default();
        let devices = deviceManager.list_devices();
        let padDevice = null;

        devices.forEach(Lang.bind(this, function(device) {
            if (deviceNode == device.get_device_node())
                padDevice = device;
        }));

        if (padDevice == null ||
            padDevice.get_device_type() != Clutter.InputDeviceType.PAD_DEVICE) {
            invocation.return_error_literal(Gio.IOErrorEnum,
                                            Gio.IOErrorEnum.CANCELLED,
                                            "Invalid params");
            return;
        }

        global.display.request_pad_osd(padDevice, editionMode);
        invocation.return_value(null);
    }
});
Signals.addSignalMethods(PadOsdService.prototype);
