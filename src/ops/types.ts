export type Role = "super_admin" | "admin" | "host";
export type EventStatus = "draft" | "active" | "completed" | "archived";

export interface EventRecord {
  id: string; name: string; slug: string; status: EventStatus; venueName: string; venueAddress: string;
  format: string; timezone: string; currency: string; shotgunStartAt: string | null;
  registrationDeadlineAt: string | null; playerDeadlineAt: string | null; rules: string;
  primaryColour: string; accentColour: string; logoPath: string | null; bannerPath: string | null;
  requiredPlayerFields: string[]; shirtSizeOptions: string[]; reminderOffsetsDays: number[];
  createdAt: string; updatedAt: string;
}

export interface EventCompany {
  id: string; eventId: string; companyId: string; name: string; registrationNumber: string;
  website: string; billingEmail: string; phone: string; relationshipStatus: string;
  primaryContactName: string; primaryContactEmail: string; primaryContactPhone: string; notes: string;
}

export interface PlayerRecord {
  id: string; position: number; fullName: string; email: string; phone: string; handicap: string;
  shirtSize: string; dietaryRequirements: string; specialRequirements: string; homeClub: string; golfId: string;
  complete?: boolean; responses?: Array<{ fieldId: string; value: unknown }>;
}

export interface FourballRecord {
  id: string; eventId: string; eventCompanyId: string; companyName: string; teamName: string;
  bookingStatus: string; confirmedAmountMinor: number; invoiceReference: string; paymentStatus: string;
  submissionStatus: string; submittedAt: string | null; notes: string; players: PlayerRecord[];
  hosts: Array<{ id: string; profileId: string; isPrimary: boolean; invitedAt: string | null; acceptedAt: string | null; fullName: string; email: string }>;
  teeSlot: { id: string; label: string } | null;
}

export interface UserRecord {
  id: string; email: string; fullName: string; role: Role; isActive: boolean; lastSeenAt: string | null;
}

