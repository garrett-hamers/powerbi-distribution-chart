declare module "powerbi-visuals-utils-formattingutils" {
  export const valueFormatter: {
    format(
      value: unknown,
      format?: string,
      allowFormatBeautification?: boolean,
      cultureSelector?: string,
    ): string;
  };
}
