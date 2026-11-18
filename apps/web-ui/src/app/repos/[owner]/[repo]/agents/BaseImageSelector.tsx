import { APPROVED_IMAGES } from "./approved-images";

interface BaseImageSelectorProps {
  value: string | null;
}

/** Curated dropdown offering only platform-published approved images; free-form entry is not allowed. */
export default function BaseImageSelector({ value }: BaseImageSelectorProps) {
  return (
    <select
      id="setting-base_image"
      name="base_image"
      defaultValue={value ?? ""}
    >
      <option value="">— inherit org default —</option>
      {APPROVED_IMAGES.map((img) => (
        <option key={img.id} value={img.id}>
          {img.label}
        </option>
      ))}
    </select>
  );
}
