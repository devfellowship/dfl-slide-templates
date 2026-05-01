export interface ThemeVars {
  primary: string
  bg: string
  text: string
  headingColor: string
  border: string
  borderOpacity: number
  fontFamily: string
  fontFamilyHeading: string
}

export interface ThemeEntry {
  id: string
  label: string
  vars: ThemeVars
  rawCss: string
}
