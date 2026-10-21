#!/bin/bash
# Assemble the Windows app folder and build the NSIS installer
set -e
S=/tmp/claude-0/-home-claude/02538ede-21bd-5fd3-ab55-5ec242fc8e3f/scratchpad
P=/home/claude/avaris-studio
ST=$P/dist/stage
rm -rf $ST/resources/app $ST/resources/engine $ST/resources/samples $ST/resources/gdal $ST/LICENSE-Avaris.txt
[ -f $ST/AvarisModeler.exe ] && mv $ST/AvarisModeler.exe $ST/OsemCM.exe
mkdir -p $ST/resources/app $ST/resources/engine $ST/resources/samples
cp $P/app/main.js $P/app/preload.js $P/app/outreader.js $P/app/package.json $ST/resources/app/
cp -r $P/app/renderer $ST/resources/app/
cp $P/app/engine/win/* $ST/resources/engine/
cp $P/app/samples/* $ST/resources/samples/
mkdir -p $ST/resources/gdal && cp -r $P/app/gdal/win/* $ST/resources/gdal/
cp $P/installer/LICENSE.txt $ST/LICENSE-OsemCM.txt
cd $P/installer
NSISDIR=$S/dl/nsis $S/dl/nsis/linux/makensis -V2 -DSTAGE=$ST -DICON=$P/build/icon.ico -DOUTFILE=$P/dist/OsemCMV2.0-Setup-2.0.9.exe avaris.nsi
ls -la $P/dist/*.exe
