const fs = require('node:fs/promises');
const path = require('node:path');
const { setIconAsync } = require('@expo/prebuild-config/build/plugins/icons/withAndroidIcons');
const { AndroidConfig, XML } = require('@expo/config-plugins');

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const { expo } = JSON.parse(await fs.readFile(path.join(projectRoot, 'app.json'), 'utf8'));
  const adaptive = expo.android.adaptiveIcon;
  // Use Expo's native icon generator without regenerating other native files.
  await setIconAsync(projectRoot, {
    icon: adaptive.foregroundImage,
    backgroundColor: adaptive.backgroundColor,
    isAdaptive: true,
  });
  const colorsPath = path.join(projectRoot, 'android/app/src/main/res/values/colors.xml');
  const colors = await AndroidConfig.Resources.readResourcesXMLAsync({ path: colorsPath });
  AndroidConfig.Colors.assignColorValue(colors, { name: 'iconBackground', value: adaptive.backgroundColor });
  await XML.writeXMLAsync({ path: colorsPath, xml: colors });
  console.log('Android launcher icons generated from', adaptive.foregroundImage);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
