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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
  Extension,
  gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';
import type { QuickToggleMenu } from '@girs/gnome-shell/ui/quickSettings';
import { ExtensionMetadata } from '@girs/gnome-shell/extensions/extension';

const BOOT_TARGETS = {
  BIOS: 'auto-reboot-to-firmware-setup',
  WINDOWS: 'windows_11.conf',
} as const;

class Timer {
  private _sourceId: number | null = null;

  start(callback: () => boolean, intervalMs: number, priority: number = GLib.PRIORITY_DEFAULT) {
    this.stop();
    this._sourceId = GLib.timeout_add(priority, intervalMs, callback);
  }

  stop() {
    if (this._sourceId) {
      GLib.Source.remove(this._sourceId);
      this._sourceId = null;
    }
  }
}

const RebootMenuItem = GObject.registerClass(
  class RebootMenuItem extends PopupMenu.PopupMenuItem {
    constructor(private title: string, private onReboot: () => void) {
      super(`${_(title)}...`);
      this.connect('activate', () => this.onReboot());
    }
  },
);

class SystemRebootManager {
  async reboot(bootTarget: string) {
    try {
      await this.setBootTarget(bootTarget);
    } catch (error) {
      if (error instanceof Object) {
        logError(error, 'Failed to execute reboot');
      }
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
  private readonly _rebootManager: SystemRebootManager;
  private _menu?: QuickToggleMenu;
  private _menuItems: InstanceType<typeof RebootMenuItem>[] = [];
  private _initializationTimer = new Timer();

  constructor(rebootManager: SystemRebootManager) {
    this._rebootManager = rebootManager;
  }

  initialize() {
    if (Main.panel.statusArea.quickSettings._system) {
      this._setupMenuItems();
    } else {
      this._waitForSystemMenu();
    }
  }

  destroy() {
    this._initializationTimer.stop();
    this._menuItems.forEach(item => item.destroy());
    this._menuItems = [];
    this._menu = undefined;
  }

  _waitForSystemMenu() {
    this._initializationTimer.start(() => {
      if (Main.panel.statusArea.quickSettings._system) {
        this._setupMenuItems();
        return GLib.SOURCE_REMOVE;
      }
      return GLib.SOURCE_CONTINUE;
    }, 100);
  }

  _setupMenuItems() {
    this._menu = Main.panel.statusArea.quickSettings._system?.quickSettingsItems[0].menu;

    if (!this._menu) {
      log('Failed to access system menu');
      return;
    }

    const biosRebootItem = new RebootMenuItem(
      'Restart to BIOS',
      () => this._rebootManager.reboot(BOOT_TARGETS.BIOS),
    );

    const windowsRebootItem = new RebootMenuItem(
      'Restart to Windows',
      () => this._rebootManager.reboot(BOOT_TARGETS.WINDOWS),
    );

    this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(), 3);
    this._menu.addMenuItem(windowsRebootItem, 4);
    this._menu.addMenuItem(biosRebootItem, 5);

    this._menuItems = [biosRebootItem, windowsRebootItem];
  }
}

export default class SystemDRebootMenuExtended extends Extension {
  private _rebootManager?: SystemRebootManager;
  private _menuIntegration?: SystemMenuIntegration;

  constructor(metadata: ExtensionMetadata) {
    super(metadata);
  }

  enable() {
    try {
      this._rebootManager = new SystemRebootManager();
      this._menuIntegration = new SystemMenuIntegration(this._rebootManager);

      this._menuIntegration.initialize();
    } catch (error) {
      if (error instanceof Object) {
        logError(error, 'Failed to enable extension');
      }
      this.disable();
    }
  }

  disable() {
    try {
      this._menuIntegration?.destroy();
    } catch (error) {
      if (error instanceof Object) {
        logError(error, 'Error during extension cleanup');
      }
    } finally {
      this._menuIntegration = undefined;
      this._rebootManager = undefined;
    }
  }
}