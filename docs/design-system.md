# Reader design tokens

`src/theme.ts` is the source for the brand, light/dark app surfaces, semantic colors, and four reader presets.

The React Native app uses `AppThemeProvider` and `useThemeStyles(createStyles)` so screens, cards and dialogs update together. Choose **Sáng / Tối / Hệ thống** in **Tài khoản → Giao diện**. The reader saves its own **Sáng / Giấy / Tối / OLED** choice. Both preferences persist locally.

Use `accent` for orange button backgrounds and `onAccent` for their dark labels. Use `accentText` for orange links; the base orange with white text does not meet AA for small labels. Teal buttons use `secondary` with `onSecondary`. Genre tags use `secondarySoft` with `secondaryText`. Small status messages use `successText`, `warningText`, or `dangerText` on the matching soft surface. Tertiary colors are for placeholders and decorative details, not essential reading text.

`node scripts/export-design-tokens.cjs` exports **design/tokens.json** for Tokens Studio / Style Dictionary and **design/tokens.css** for web consumers. Regenerate these files after changing `src/theme.ts`.

`node --test test/theme.test.cjs` checks AA contrast for primary/secondary text, action labels, accent links and status messages, and AAA for chapter body text in every reader preset. These checks cover the selected color pairs; they do not certify the entire application for WCAG conformance.
