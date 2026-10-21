#!/bin/bash
# Assemble the Windows app folder and build the NSIS installer
set -e
# P = this repository; ST = unpacked Electron for Windows x64 (electron-v33.2.1-win32-x64.zip); NSIS = NSIS 3 for Linux
P=$(cd "$(dirname "$0")" && pwd)
ST=${STAGE:-$P/dist/stage}
NSIS=${NSIS:-/tmp/claude-0/-home-claude/02538ede-21bd-5fd3-ab55-5ec242fc8e3f/scratchpad/dl/nsis}
VER=$(python3 -c "import json;print(json.load(open('$P/app/package.json'))['version'])")
[ -f $ST/electron.exe ] && mv $ST/electron.exe $ST/Avaris2CS.exe
rm -rf $ST/resources/app $ST/resources/engine $ST/resources/samples $ST/resources/gdal $ST/LICENSE-Avaris.txt
for old in AvarisModeler.exe OsemCM.exe Avaris2.exe; do [ -f $ST/$old ] && mv $ST/$old $ST/Avaris2CS.exe || true; done
rm -f $ST/LICENSE-OsemCM.txt $ST/LICENSE-Avaris2.txt
# application icon inside the exe (Explorer, taskbar)
python3 $P/tools/peicon.py $ST/Avaris2CS.exe $P/build/icon.png
mkdir -p $ST/resources/app $ST/resources/engine $ST/resources/samples
cp $P/app/main.js $P/app/preload.js $P/app/outreader.js $P/app/package.json $ST/resources/app/
cp -r $P/app/renderer $ST/resources/app/
cp $P/app/engine/win/* $ST/resources/engine/
cp $P/app/samples/* $ST/resources/samples/
mkdir -p $ST/resources/gdal && cp -r $P/app/gdal/win/* $ST/resources/gdal/
cp $P/installer/LICENSE.txt $ST/LICENSE-Avaris2CS.txt
{ cat $P/installer/THIRD-PARTY-NOTICES.txt; printf '\n\nGDAL LICENCE\n============\n\n'; cat $P/app/gdal/win/GDAL-LICENSE.txt; printf '\n\nPROJ LICENCE\n============\n\n'; cat $P/app/gdal/win/PROJ-LICENSE.txt; } > $ST/THIRD-PARTY-NOTICES.txt
cd $P/installer
NSISDIR=$NSIS $NSIS/linux/makensis -V2 -DVER=$VER -DSTAGE=$ST -DICON=$P/build/icon.ico -DOUTFILE=$P/dist/Avaris2CS-Setup-$VER.exe avaris.nsi
ls -la $P/dist/*.exe
