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

const RebootMenuItem = GObject.registerClass(
  class RebootMenuItem extends PopupMenu.PopupMenuItem {
    private counter!: number;
    private seconds!: number;
    private counterIntervalId!: number | null;
    private messageIntervalId!: number | null;

    constructor(title: string, onReboot: () => void) {
      super(`${_(title)}...`);

      this.counter = 0;
      this.seconds = 0;
      this.counterIntervalId = null;
      this.messageIntervalId = null;

      this.connect('activate', () => {
        this.counter = 60;
        this.seconds = this.counter;

        const dialog = this.buildDialog(title, onReboot);
        dialog.open();

        this.counterIntervalId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
          if (this.counter > 0) {
            this.counter--;
            if (this.counter % 10 === 0) {
              this.seconds = this.counter;
            }
            return GLib.SOURCE_CONTINUE;
          } else {
            this.clearIntervals();
            onReboot();
            return GLib.SOURCE_REMOVE;
          }
        });
      });
    }

    destroy() {
      this.clearIntervals();
      super.destroy();
    }

    private buildDialog(title: string, onSkipTimer: () => void): ModalDialog.ModalDialog {
      const dialog = new ModalDialog.ModalDialog({ styleClass: 'modal-dialog' });
      dialog.setButtons([
        {
          label: _('Cancel'),
          action: () => {
            this.clearIntervals();
            dialog.close();
          },
          key: Clutter.KEY_Escape,
          default: false,
        },
        {
          label: _('Restart'),
          action: () => {
            this.clearIntervals();
            onSkipTimer();
          },
          default: false,
        },
      ]);

      const dialogTitle = new St.Label({
        text: _(title),
        style: 'font-weight: bold;font-size:18px',
      });

      let dialogMessage = new St.Label({
        text: this.getDialogMessageText(),
      });
      dialogMessage.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
      dialogMessage.clutterText.lineWrap = true;

      const titleBox = new St.BoxLayout({
        xAlign: Clutter.ActorAlign.CENTER,
      });
      titleBox.add_child(new St.Label({ text: '  ' }));
      titleBox.add_child(dialogTitle);

      let box = new St.BoxLayout({ yExpand: true, vertical: true });
      box.add_child(titleBox);
      box.add_child(new St.Label({ text: '  ' }));
      box.add_child(dialogMessage);

      this.messageIntervalId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        dialogMessage?.set_text(this.getDialogMessageText());
        return GLib.SOURCE_CONTINUE;
      });

      dialog.contentLayout.add_child(box);

      return dialog;
    }

    private getDialogMessageText(): string {
      return _(`The system will restart automatically in %d seconds.`).replace(
        '%d',
        String(this.seconds),
      );
    }

    private clearIntervals(): void {
      if (this.counterIntervalId) {
        GLib.Source.remove(this.counterIntervalId);
        this.counterIntervalId = null;
      }
      if (this.messageIntervalId) {
        GLib.Source.remove(this.messageIntervalId);
        this.messageIntervalId = null;
      }
    }
  });

const ManagerInterface = `<node>
  <interface name="org.freedesktop.login1.Manager">
    <method name="Reboot">
      <arg type="b" direction="in"/>
    </method>
  </interface>
  </node>` as string;

export default class SystemDRebootMenuExtended extends Extension {
  private menu: QuickToggleMenu | null = null;
  private proxy: Gio.DBusProxy | null = null;
  private rebootToBiosPowerMenuItem: PopupMenu.PopupMenuItem | null = null;
  private rebootToWindowsPowerMenuItem: PopupMenu.PopupMenuItem | null = null;
  private sourceId: number | null = null;
  private manager: ReturnType<typeof Gio.DBusProxy.makeProxyWrapper<typeof ManagerInterface>> | null = null;

  constructor(metadata: ExtensionMetadata) {
    super(metadata);
  }

  enable() {
    this.manager = Gio.DBusProxy.makeProxyWrapper(ManagerInterface);
    if (!panel.statusArea.quickSettings._system) {
      this.queueModifySystemItem();
    } else {
      this.modifySystemItem();
    }
  }

  disable() {
    this.manager = null;
    this.rebootToBiosPowerMenuItem?.destroy();
    this.rebootToBiosPowerMenuItem = null;
    this.rebootToWindowsPowerMenuItem?.destroy();
    this.rebootToWindowsPowerMenuItem = null;
    this.proxy = null;
    if (this.sourceId) {
      GLib.Source.remove(this.sourceId);
      this.sourceId = null;
    }
  }

  private modifySystemItem() {
    if (this.manager === null) return;
    
    this.menu = panel.statusArea.quickSettings._system?.quickSettingsItems[0].menu;
    this.rebootToBiosPowerMenuItem = new RebootMenuItem('Restart to BIOS', () => this.reboot('auto-reboot-to-firmware-setup'));
    this.rebootToWindowsPowerMenuItem = new RebootMenuItem('Restart to Windows', () => this.reboot('windows-11'));

    this.proxy = this.manager(
      Gio.DBus.system,
      'org.freedesktop.login1',
      '/org/freedesktop/login1',
    );

    this.menu!.addMenuItem(this.rebootToWindowsPowerMenuItem, 2);
    this.menu!.addMenuItem(this.rebootToBiosPowerMenuItem, 3);
  }

  private queueModifySystemItem(): void {
    this.sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      if (!panel.statusArea.quickSettings._system) return GLib.SOURCE_CONTINUE;

      this.modifySystemItem();
      return GLib.SOURCE_REMOVE;
    });
  }

  private async reboot(bootloaderTarget: string) {
    const [, argv] = GLib.shell_parse_argv(`pkexec systemctl reboot --boot-loader-entry=${bootloaderTarget}`);
    const proc = Gio.Subprocess.new(argv!, Gio.SubprocessFlags.NONE);
    await proc.wait_check_async(null);
    this.proxy?.RebootRemote(true);
  }
}
