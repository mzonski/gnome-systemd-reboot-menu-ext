NAME=systemdrebootmenuext
DOMAIN=zonni.pl

.PHONY: all pack install clean

all: dist/extension.js

node_modules: package.json
	npm install

dist/extension.js: node_modules
	@ ./node_modules/typescript/bin/tsc

compile-po: po/*.po
	@for file in po/*.po; do \
		mkdir -p dist/locale/$$(basename $$file .po)/LC_MESSAGES; \
		msgfmt -o dist/locale/$$(basename $$file .po)/LC_MESSAGES/$(NAME)@$(DOMAIN).mo $$file; \
	done

$(NAME)@$(DOMAIN).zip: dist/extension.js
	@cp src/metadata.json dist/
	@$(MAKE) compile-po
	@(cd dist && zip ../$(NAME)@$(DOMAIN).zip -9r .)

pack: $(NAME)@$(DOMAIN).zip

install: $(NAME)@$(DOMAIN).zip
	@[ -d ~/.local/share/gnome-shell/extensions ] || mkdir -p ~/.local/share/gnome-shell/extensions
	@gnome-extensions install $(NAME)@$(DOMAIN).zip --force

redeploy:
	@rm -rf ~/.local/share/gnome-shell/extensions/$(NAME)@$(DOMAIN).zip
	@ ./node_modules/typescript/bin/tsc
	@$(MAKE) pack
	@$(MAKE) install

clean:
	@rm -rf dist node_modules $(NAME)@$(DOMAIN).zip