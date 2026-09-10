import type { PlayerRecord } from "./types";

export const playerFields = [
  { key: "full_name", name: "fullName", label: "Full name" },
  { key: "email", name: "email", label: "Email" },
  { key: "phone", name: "phone", label: "Phone" },
  { key: "handicap", name: "handicap", label: "Handicap" },
  { key: "shirt_size", name: "shirtSize", label: "Shirt size" },
  { key: "dietary_requirements", name: "dietaryRequirements", label: "Dietary requirements" },
  { key: "special_requirements", name: "specialRequirements", label: "Special requirements" },
  { key: "home_club", name: "homeClub", label: "Home club" },
  { key: "golf_id", name: "golfId", label: "Golf ID" },
] as const;

export function PlayerInputs({ event, player, disabled = false, enforceRequired = false }: {
  event: { visiblePlayerFields?: string[]; requiredPlayerFields: string[]; shirtSizeOptions: string[] };
  player: PlayerRecord;
  disabled?: boolean;
  enforceRequired?: boolean;
}) {
  return <>{playerFields.filter(({ key }) => !event.visiblePlayerFields || event.visiblePlayerFields.includes(key)).map(({ key, name, label }) => {
    const required = enforceRequired && event.requiredPlayerFields.includes(key);
    return <label key={key}><span>{label}{required ? " *" : ""}</span>{name === "shirtSize" ?
      <select name={name} defaultValue={player[name]} disabled={disabled} required={required}><option value="">Select size</option>{event.shirtSizeOptions.map((size) => <option key={size}>{size}</option>)}</select> :
      <input name={name} type={name === "email" ? "email" : "text"} defaultValue={player[name]} disabled={disabled} required={required} />}</label>;
  })}</>;
}
