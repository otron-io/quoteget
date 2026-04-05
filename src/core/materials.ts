export const SUPPORTED_MATERIALS = [
  "aluminum_6061",
  "aluminum_7075",
] as const;

export type MaterialSlug = (typeof SUPPORTED_MATERIALS)[number];

export const DEFAULT_MATERIAL: MaterialSlug = "aluminum_6061";

interface VendorMaterialDefinition {
  material: string;
}

interface HubsMaterialDefinition extends VendorMaterialDefinition {
  subsetId: number;
}

interface RapidDirectMaterialDefinition extends VendorMaterialDefinition {
  optionLabel: string;
}

export interface MaterialDefinition {
  slug: MaterialSlug;
  label: string;
  hubs: HubsMaterialDefinition;
  xometry: VendorMaterialDefinition;
  rapiddirect: RapidDirectMaterialDefinition;
  protolabs: VendorMaterialDefinition;
}

const MATERIAL_DEFINITIONS: Record<MaterialSlug, MaterialDefinition> = {
  aluminum_6061: {
    slug: "aluminum_6061",
    label: "Aluminum 6061",
    hubs: {
      material: "cnc-machining_aluminum-6061",
      subsetId: 86,
    },
    xometry: {
      material: "Aluminum 6061",
    },
    rapiddirect: {
      material: "Aluminum 6061",
      optionLabel: "Aluminum 6061",
    },
    protolabs: {
      material: "Aluminum 6061-T651/T6",
    },
  },
  aluminum_7075: {
    slug: "aluminum_7075",
    label: "Aluminum 7075",
    hubs: {
      material: "cnc-machining_aluminum-7075",
      subsetId: 124,
    },
    xometry: {
      material: "Aluminum 7075",
    },
    rapiddirect: {
      material: "Aluminum 7075",
      optionLabel: "Aluminum 7075",
    },
    protolabs: {
      material: "Aluminum 7075-T651/T6",
    },
  },
};

export function getMaterialDefinition(material: MaterialSlug): MaterialDefinition {
  return MATERIAL_DEFINITIONS[material];
}

export function isMaterialSlug(value: string): value is MaterialSlug {
  return Object.hasOwn(MATERIAL_DEFINITIONS, value);
}

export function listMaterialDefinitions(): MaterialDefinition[] {
  return SUPPORTED_MATERIALS.map((material) => MATERIAL_DEFINITIONS[material]);
}
