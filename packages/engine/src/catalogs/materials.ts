// The catalog `materials` (D48): the density of printing materials, each from the technical data
// sheet of a named maker. The command setBodyMaterial copies a row into the properties of a body:
// the key as the label and the density as a number, so a corrected row does not change an old
// model.
import type { DataCatalog } from '../data-catalogs';

export interface MaterialRow {
  density: number; // g/cm3, of the solid material
  source: string; // the data sheet the number is taken from
}

declare module '../data-catalogs' {
  interface Catalogs {
    materials: MaterialRow;
  }
}

// The owner's rule (2026-11-15): the density from the technical data sheet of Prusament, and from
// that of Bambu Lab where Prusament does not make the material; a material neither makes is left
// out, not filled in from another source. No metals: a bought part has the mass of its data sheet.
// - PA12 has no row: Prusament makes PA11 and no PA12, and every nylon of Bambu Lab is filled with
//   fibres. A question for the owner (docs/d36/3a-body-properties/design.md, "As implemented").
// - ABS is from Bambu Lab: Prusament makes no ABS.
// - TPU: the data sheet says 1.25; the PrusaSlicer profile of the same filament says 1.23. The data
//   sheet is the source.
// - PC is Prusament PC Blend, its only unfilled polycarbonate; its sheet measures by an in-house
//   method of Prusa Polymers, not by ISO 1183 as the others.
// Every number was read from the sheet named in its row on 2026-11-16 and checked against a second
// published value (the PrusaSlicer profile, or a retailer for Bambu ABS).
export const MATERIALS: DataCatalog<MaterialRow> = {
  title: 'Printing materials',
  summary:
    'The density of printing materials in g/cm3, of the solid material as the data sheet of the maker gives it. A printed part has shells and infill and weighs less, so a mass computed from it is an upper bound until the density of the body is corrected (an expression over an infill parameter, say) or its mass is weighed. Set a body to a row with the command setBodyMaterial.',
  source: 'The technical data sheets of Prusament, and of Bambu Lab where Prusament does not make the material; each row names its sheet',
  columns: { density: { title: 'Density', unit: 'g/cm3' }, source: { title: 'Data sheet', unit: 'text' } },
  rows: {
    PLA: {
      density: 1.24,
      source:
        'Prusament PLA, Technical Data Sheet version 1.1 of 27-07-2022, ISO 1183 (1_PLA_Prusament_TDS_2022_EN.pdf in https://storage.googleapis.com/prusa3d-content-prod-14e8-wordpress-prusament-prod/2024/05/7ca620c4-prusament-pla-plablend.zip)',
    },
    PETG: {
      density: 1.27,
      source: 'Prusament PETG, Technical Data Sheet version 1.1 of 16-02-2022, ISO 1183 (https://storage.googleapis.com/prusa3d-content-prod-14e8-wordpress-prusament-prod/2023/10/9f8d2165-tds_prusament-petg_n_en.pdf)',
    },
    ABS: {
      density: 1.05,
      source: 'Bambu ABS (Prusament makes no ABS), Technical Data Sheet V3.0, ISO 1183 (https://store.bblcdn.com/s7/default/23b4cf2b83d5470bb96d19970b5f3ae8/Bambu_ABS_Technical_Data_Sheet_V3.pdf)',
    },
    ASA: {
      density: 1.07,
      source: 'Prusament ASA, Technical Data Sheet version 1.1 of 20-05-2024, ISO 1183 (https://storage.googleapis.com/prusa3d-content-prod-14e8-wordpress-prusament-prod/2024/05/bc8551ef-tds_prusament-asa_2024_en.pdf)',
    },
    TPU: {
      density: 1.25,
      source:
        'Prusament TPU 95A, Technical Data Sheet version 1.0 of 29-05-2025, ISO 1183 (https://storage.googleapis.com/prusa3d-content-prod-14e8-wordpress-prusament-prod/2025/05/80316f6d-tds-prusament_tpu_95a_en-1.pdf); the PrusaSlicer profile says 1.23',
    },
    PC: {
      density: 1.22,
      source: 'Prusament PC Blend, Technical Data Sheet version 1.1 of 16-02-2022, method of Prusa Polymers, not ISO 1183 (https://prusament.com/wp-content/uploads/2022/10/PCBlend_Prusament_TDS_2022_16_EN.pdf)',
    },
  },
};
