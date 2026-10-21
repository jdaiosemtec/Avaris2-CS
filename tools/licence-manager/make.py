# Builds Avaris2CS_Licence_Manager.html (one self-contained file) from manager.src.html + TweetNaCl.js 0.14.5 (public domain).
import pathlib
d = pathlib.Path(__file__).parent
src = (d / 'manager.src.html').read_text(encoding='utf8')
nacl = (d / 'nacl-fast.min.js').read_text(encoding='utf8')
out = src.replace('/*NACL*/', '/* TweetNaCl.js 0.14.5 - public domain - https://github.com/dchest/tweetnacl-js */\n' + nacl.replace('</script', '<\\/script'))
(d / 'Avaris2CS_Licence_Manager.html').write_text(out, encoding='utf8')
print('ok', len(out))
