/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-only
 */

/* exported init */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Pango from 'gi://Pango';
import { panel } from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';


import {
  Extension,
  gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';
import type { QuickToggleMenu } from '@girs/gnome-shell/ui/quickSettings';
import { ExtensionMetadata } from '@girs/gnome-shell/extensions/extension';

const REBOOT_COUNTDOWN_SECONDS = 10;
const COUNTDOWN_UPDATE_INTERVAL = 1;
const MESSAGE_UPDATE_INTERVAL_MS = 500;

const BOOT_TARGETS = {
  BIOS: 'auto-reboot-to-firmware-setup',
  WINDOWS: 'windows-11',
} as const;


class Timer {
  private _sourceId: number | null = null;

  start(callback: () => boolean, intervalMs: number, priority: number = GLib.PRIORITY_DEFAULT) {
    this.stop();
    this._sourceId = GLib.timeout_add(priority, intervalMs, callback);
  }

  startSeconds(callback: () => boolean, intervalSeconds: number, priority: number = GLib.PRIORITY_DEFAULT) {
    this.stop();
    this._sourceId = GLib.timeout_add_seconds(priority, intervalSeconds, callback);
  }

  stop() {
    if (this._sourceId) {
      GLib.Source.remove(this._sourceId);
      this._sourceId = null;
    }
  }
}

class RebootCountdown {
  private remainingSeconds: number;
  private displaySeconds: number;
  private readonly _countdownTimer = new Timer();
  private readonly _displayTimer = new Timer();
  private readonly _onComplete: () => void;
  private readonly _onUpdate: (seconds: number) => void;

  constructor(onComplete: () => void, onUpdate: (seconds: number) => void) {
    this.remainingSeconds = REBOOT_COUNTDOWN_SECONDS;
    this.displaySeconds = this.remainingSeconds;
    this._onComplete = onComplete;
    this._onUpdate = onUpdate;
  }

  start() {
    this.remainingSeconds = REBOOT_COUNTDOWN_SECONDS;
    this.displaySeconds = this.remainingSeconds;
    this._onUpdate(this.displaySeconds);

    this._countdownTimer.startSeconds(() => {
      this.remainingSeconds--;

      if (this.remainingSeconds % COUNTDOWN_UPDATE_INTERVAL === 0) {
        this.displaySeconds = this.remainingSeconds;
      }

      if (this.remainingSeconds <= 0) {
        this.stop();
        this._onComplete();
        return GLib.SOURCE_REMOVE;
      }

      return GLib.SOURCE_CONTINUE;
    }, 1);

    this._displayTimer.start(() => {
      this._onUpdate(this.displaySeconds);
      return GLib.SOURCE_CONTINUE;
    }, MESSAGE_UPDATE_INTERVAL_MS);
  }

  stop() {
    this._countdownTimer.stop();
    this._displayTimer.stop();
  }
}

class RebootConfirmationDialog {
  private readonly messageLabel: St.Label;
  private dialog: ModalDialog.ModalDialog;
  private countdown: RebootCountdown;

  constructor(title: string, onConfirm: () => void, onCancel: () => void) {
    this.dialog = this.createDialog(title, onConfirm, onCancel);
    this.messageLabel = this.createMessageLabel();
    this.countdown = new RebootCountdown(
      onConfirm,
      (seconds) => this.updateMessage(seconds),
    );

    this.setupDialogContent(title);
  }

  private createDialog(title: string, onConfirm: () => void, onCancel: () => void): ModalDialog.ModalDialog {
    const dialog = new ModalDialog.ModalDialog({ styleClass: 'modal-dialog' });

    dialog.setButtons([
      {
        label: _('Cancel'),
        action: () => {
          this.destroy();
          onCancel();
        },
        key: Clutter.KEY_Escape,
        default: false,
      },
      {
        label: _('Restart Now'),
        action: () => {
          this.destroy();
          onConfirm();
        },
        default: false,
      },
    ]);

    return dialog;
  }

  private createMessageLabel(): St.Label {
    const label = new St.Label({
      text: this.getMessageText(REBOOT_COUNTDOWN_SECONDS),
    });
    label.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
    label.clutterText.lineWrap = true;
    return label;
  }

  private setupDialogContent(title: string) {
    const titleLabel = new St.Label({
      text: _(title),
      style: 'font-weight: bold; font-size: 18px; margin-bottom: 12px;',
    });

    const titleBox = new St.BoxLayout({
      xAlign: Clutter.ActorAlign.CENTER,
    });
    titleBox.add_child(titleLabel);

    const contentBox = new St.BoxLayout({
      yExpand: true,
      vertical: true,
      style: 'spacing: 12px;',
    });
    contentBox.add_child(titleBox);
    contentBox.add_child(this.messageLabel);

    this.dialog.contentLayout.add_child(contentBox);
  }

  private updateMessage(seconds: number) {
    this.messageLabel.set_text(this.getMessageText(seconds));
  }

  private getMessageText(seconds: number) {
    return _('The system will restart automatically in %d seconds.').replace('%d', String(seconds));
  }

  show() {
    this.dialog.open();
    this.countdown.start();
  }

  destroy() {
    this.countdown.stop();
    this.dialog.close();
  }
}

const RebootMenuItem = GObject.registerClass(
  class RebootMenuItem extends PopupMenu.PopupMenuItem {
    private dialog: RebootConfirmationDialog | null = null;

    constructor(private title: string, private onReboot: () => void) {
      super(`${_(title)}...`);
      this.connect('activate', () => this._handleActivation());
    }

    destroy() {
      this._cleanup();
      super.destroy();
    }

    _handleActivation() {
      if (this.dialog) {
        this.dialog.destroy();
      }

      this.dialog = new RebootConfirmationDialog(
        this.title,
        () => this._executeReboot(),
        () => this._cancelReboot(),
      );

      this.dialog.show();
    }

    _executeReboot() {
      this._cleanup();
      this.onReboot();
    }

    _cancelReboot() {
      this._cleanup();
    }

    _cleanup() {
      if (this.dialog) {
        this.dialog = null;
      }
    }
  },
);

class SystemRebootManager {
  async reboot(bootTarget: string) {
    try {
      await this.setBootTarget(bootTarget);
    } catch (error) {
      log('Failed to execute reboot: ' + error);
      throw error;
    }
  }

  private async setBootTarget(target: string) {
    const command = `pkexec systemctl reboot --boot-loader-entry=${target}`;
    const [, argv] = GLib.shell_parse_argv(command);
    const process = Gio.Subprocess.new(argv!, Gio.SubprocessFlags.NONE);
    await process.wait_check_async(null);
  }
}

class SystemMenuIntegration {
  private menu: QuickToggleMenu | null = null;
  private menuItems: InstanceType<typeof RebootMenuItem>[] = [];
  private initializationTimer = new Timer();

  constructor(private rebootManager: SystemRebootManager) {
  }

  initialize() {
    if (panel.statusArea.quickSettings._system) {
      this._setupMenuItems();
    } else {
      this._waitForSystemMenu();
    }
  }

  destroy() {
    this.initializationTimer.stop();
    this.menuItems.forEach(item => item.destroy());
    this.menuItems = [];
    this.menu = null;
  }

  _waitForSystemMenu() {
    this.initializationTimer.start(() => {
      if (panel.statusArea.quickSettings._system) {
        this._setupMenuItems();
        return GLib.SOURCE_REMOVE;
      }
      return GLib.SOURCE_CONTINUE;
    }, 100);
  }

  _setupMenuItems() {
    this.menu = panel.statusArea.quickSettings._system?.quickSettingsItems[0].menu;

    if (!this.menu) {
      log('Failed to access system menu');
      return;
    }

    const biosRebootItem = new RebootMenuItem(
      'Restart to BIOS',
      () => this.rebootManager.reboot(BOOT_TARGETS.BIOS),
    );

    const windowsRebootItem = new RebootMenuItem(
      'Restart to Windows',
      () => this.rebootManager.reboot(BOOT_TARGETS.WINDOWS),
    );

    this.menu.addMenuItem(windowsRebootItem, 2);
    this.menu.addMenuItem(biosRebootItem, 3);

    this.menuItems = [biosRebootItem, windowsRebootItem];
  }
}

export default class SystemDRebootMenuExtended extends Extension {
  private rebootManager: SystemRebootManager | null = null;
  private menuIntegration: SystemMenuIntegration | null = null;

  constructor(metadata: ExtensionMetadata) {
    super(metadata);
  }

  enable() {
    try {
      this.rebootManager = new SystemRebootManager();
      this.menuIntegration = new SystemMenuIntegration(this.rebootManager);
      this.menuIntegration.initialize();
    } catch (error) {
      log('Failed to enable extension:' + error);
      this.disable();
    }
  }

  disable() {
    try {
      this.menuIntegration?.destroy();
    } catch (error) {
      log('Error during extension cleanup:' + error);
    } finally {
      this.menuIntegration = null;
      this.rebootManager = null;
    }
  }
}