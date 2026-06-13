export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_preferences: {
        Row: {
          channel_map: Json
          enabled_types: string[]
          extra_recipients: Json
          language: string
          organisation_id: string
          quiet_hours: Json
          updated_at: string
        }
        Insert: {
          channel_map?: Json
          enabled_types?: string[]
          extra_recipients?: Json
          language?: string
          organisation_id: string
          quiet_hours?: Json
          updated_at?: string
        }
        Update: {
          channel_map?: Json
          enabled_types?: string[]
          extra_recipients?: Json
          language?: string
          organisation_id?: string
          quiet_hours?: Json
          updated_at?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          acknowledged: boolean
          action: string | null
          alert_type: string
          body: string | null
          channel: string
          channels: string[]
          code: string
          delivered_count: number
          failed_count: number
          id: string
          incident_id: string | null
          language: string
          organisation_id: string
          recipient_user_ids: string[]
          recipients: number
          scheduled_for: string | null
          sent_at: string
          severity: number
          status: string
          title: string
        }
        Insert: {
          acknowledged?: boolean
          action?: string | null
          alert_type?: string
          body?: string | null
          channel?: string
          channels?: string[]
          code?: string
          delivered_count?: number
          failed_count?: number
          id?: string
          incident_id?: string | null
          language?: string
          organisation_id: string
          recipient_user_ids?: string[]
          recipients?: number
          scheduled_for?: string | null
          sent_at?: string
          severity: number
          status?: string
          title: string
        }
        Update: {
          acknowledged?: boolean
          action?: string | null
          alert_type?: string
          body?: string | null
          channel?: string
          channels?: string[]
          code?: string
          delivered_count?: number
          failed_count?: number
          id?: string
          incident_id?: string | null
          language?: string
          organisation_id?: string
          recipient_user_ids?: string[]
          recipients?: number
          scheduled_for?: string | null
          sent_at?: string
          severity?: number
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string
          actor_name: string | null
          created_at: string
          details: Json | null
          entity: string
          entity_id: string | null
          id: string
          organisation_id: string | null
        }
        Insert: {
          action: string
          actor_id: string
          actor_name?: string | null
          created_at?: string
          details?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
          organisation_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          actor_name?: string | null
          created_at?: string
          details?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
          organisation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_activity: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string
          id: string
          incident_id: string
          kind: string
          message: string
          meta: Json
          organisation_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          id?: string
          incident_id: string
          kind: string
          message: string
          meta?: Json
          organisation_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          id?: string
          incident_id?: string
          kind?: string
          message?: string
          meta?: Json
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_activity_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_escalations: {
        Row: {
          acknowledged: boolean
          acknowledged_at: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          id: string
          incident_id: string
          message: string
          organisation_id: string
          target: string
        }
        Insert: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by: string
          id?: string
          incident_id: string
          message: string
          organisation_id: string
          target: string
        }
        Update: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          id?: string
          incident_id?: string
          message?: string
          organisation_id?: string
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_escalations_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_links: {
        Row: {
          created_at: string
          created_by: string
          id: string
          incident_id: string
          linked_incident_id: string
          organisation_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          incident_id: string
          linked_incident_id: string
          organisation_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          incident_id?: string
          linked_incident_id?: string
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_links_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_links_linked_incident_id_fkey"
            columns: ["linked_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_notes: {
        Row: {
          author_id: string
          author_name: string | null
          body: string
          client_visible: boolean
          created_at: string
          id: string
          incident_id: string
          mentions: string[]
          organisation_id: string
        }
        Insert: {
          author_id: string
          author_name?: string | null
          body: string
          client_visible?: boolean
          created_at?: string
          id?: string
          incident_id: string
          mentions?: string[]
          organisation_id: string
        }
        Update: {
          author_id?: string
          author_name?: string | null
          body?: string
          client_visible?: boolean
          created_at?: string
          id?: string
          incident_id?: string
          mentions?: string[]
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_notes_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          client_visible: boolean
          code: string
          coord_x: number | null
          coord_y: number | null
          description: string | null
          evidence: Json
          id: string
          linked_incident_id: string | null
          location: string
          location_id: string | null
          occurred_at: string
          officer: string | null
          organisation_id: string
          quick_report: boolean
          reported_at: string
          reported_by: string | null
          severity: number
          status: Database["public"]["Enums"]["incident_status"]
          suspect_count: number | null
          suspect_description: string | null
          title: string | null
          type: Database["public"]["Enums"]["incident_type"]
          updated_at: string
          victim_contact: string | null
          victim_name: string | null
          witnesses: string | null
          zone: string
        }
        Insert: {
          client_visible?: boolean
          code?: string
          coord_x?: number | null
          coord_y?: number | null
          description?: string | null
          evidence?: Json
          id?: string
          linked_incident_id?: string | null
          location: string
          location_id?: string | null
          occurred_at?: string
          officer?: string | null
          organisation_id: string
          quick_report?: boolean
          reported_at?: string
          reported_by?: string | null
          severity: number
          status?: Database["public"]["Enums"]["incident_status"]
          suspect_count?: number | null
          suspect_description?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["incident_type"]
          updated_at?: string
          victim_contact?: string | null
          victim_name?: string | null
          witnesses?: string | null
          zone: string
        }
        Update: {
          client_visible?: boolean
          code?: string
          coord_x?: number | null
          coord_y?: number | null
          description?: string | null
          evidence?: Json
          id?: string
          linked_incident_id?: string | null
          location?: string
          location_id?: string | null
          occurred_at?: string
          officer?: string | null
          organisation_id?: string
          quick_report?: boolean
          reported_at?: string
          reported_by?: string | null
          severity?: number
          status?: Database["public"]["Enums"]["incident_status"]
          suspect_count?: number | null
          suspect_description?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["incident_type"]
          updated_at?: string
          victim_contact?: string | null
          victim_name?: string | null
          witnesses?: string | null
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "organisation_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_reads: {
        Row: {
          alert_id: string
          id: string
          read_at: string
          user_id: string
        }
        Insert: {
          alert_id: string
          id?: string
          read_at?: string
          user_id: string
        }
        Update: {
          alert_id?: string
          id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_emergency_contacts: {
        Row: {
          created_at: string
          id: string
          label: string
          name: string | null
          notes: string | null
          organisation_id: string
          phone: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          name?: string | null
          notes?: string | null
          organisation_id: string
          phone: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          name?: string | null
          notes?: string | null
          organisation_id?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_emergency_contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_locations: {
        Row: {
          address: string | null
          coord_x: number | null
          coord_y: number | null
          created_at: string
          geofence: Json | null
          id: string
          name: string
          organisation_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          coord_x?: number | null
          coord_y?: number | null
          created_at?: string
          geofence?: Json | null
          id?: string
          name: string
          organisation_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          coord_x?: number | null
          coord_y?: number | null
          created_at?: string
          geofence?: Json | null
          id?: string
          name?: string
          organisation_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_locations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_members: {
        Row: {
          created_at: string
          id: string
          organisation_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organisation_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organisation_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_members_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_settings: {
        Row: {
          alert_escalation_contacts: Json
          default_incident_categories: string[]
          organisation_id: string
          report_delivery_schedule: string | null
          updated_at: string
          webhook_secret: string | null
          webhook_url: string | null
          whatsapp_alert_numbers: string[]
        }
        Insert: {
          alert_escalation_contacts?: Json
          default_incident_categories?: string[]
          organisation_id: string
          report_delivery_schedule?: string | null
          updated_at?: string
          webhook_secret?: string | null
          webhook_url?: string | null
          whatsapp_alert_numbers?: string[]
        }
        Update: {
          alert_escalation_contacts?: Json
          default_incident_categories?: string[]
          organisation_id?: string
          report_delivery_schedule?: string | null
          updated_at?: string
          webhook_secret?: string | null
          webhook_url?: string | null
          whatsapp_alert_numbers?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "organisation_settings_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: true
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          address: string | null
          billing_contact_email: string | null
          billing_contact_name: string | null
          billing_contact_phone: string | null
          brand_primary_color: string | null
          brand_secondary_color: string | null
          coord_x: number | null
          coord_y: number | null
          created_at: string
          created_by: string | null
          id: string
          logo_url: string | null
          name: string
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          subscription_tier: Database["public"]["Enums"]["subscription_tier"]
          type: Database["public"]["Enums"]["org_type"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          billing_contact_email?: string | null
          billing_contact_name?: string | null
          billing_contact_phone?: string | null
          brand_primary_color?: string | null
          brand_secondary_color?: string | null
          coord_x?: number | null
          coord_y?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name: string
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          type?: Database["public"]["Enums"]["org_type"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          billing_contact_email?: string | null
          billing_contact_name?: string | null
          billing_contact_phone?: string | null
          brand_primary_color?: string | null
          brand_secondary_color?: string | null
          coord_x?: number | null
          coord_y?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          type?: Database["public"]["Enums"]["org_type"]
          updated_at?: string
        }
        Relationships: []
      }
      patrol_check_ins: {
        Row: {
          coord_x: number | null
          coord_y: number | null
          created_at: string
          distance_m: number | null
          id: string
          method: string
          minutes_late: number
          officer_id: string | null
          officer_name: string | null
          organisation_id: string
          patrol_id: string
          shift_id: string
          status: string
          waypoint_id: string
        }
        Insert: {
          coord_x?: number | null
          coord_y?: number | null
          created_at?: string
          distance_m?: number | null
          id?: string
          method?: string
          minutes_late?: number
          officer_id?: string | null
          officer_name?: string | null
          organisation_id: string
          patrol_id: string
          shift_id: string
          status?: string
          waypoint_id: string
        }
        Update: {
          coord_x?: number | null
          coord_y?: number | null
          created_at?: string
          distance_m?: number | null
          id?: string
          method?: string
          minutes_late?: number
          officer_id?: string | null
          officer_name?: string | null
          organisation_id?: string
          patrol_id?: string
          shift_id?: string
          status?: string
          waypoint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_check_ins_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "patrol_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_check_ins_waypoint_id_fkey"
            columns: ["waypoint_id"]
            isOneToOne: false
            referencedRelation: "patrol_waypoints"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_shifts: {
        Row: {
          backup_officer_id: string | null
          created_at: string
          ended_at: string | null
          handover_notes: string | null
          id: string
          officer_id: string | null
          officer_name: string | null
          organisation_id: string
          patrol_id: string
          scheduled_end: string
          scheduled_start: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          backup_officer_id?: string | null
          created_at?: string
          ended_at?: string | null
          handover_notes?: string | null
          id?: string
          officer_id?: string | null
          officer_name?: string | null
          organisation_id: string
          patrol_id: string
          scheduled_end: string
          scheduled_start: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          backup_officer_id?: string | null
          created_at?: string
          ended_at?: string | null
          handover_notes?: string | null
          id?: string
          officer_id?: string | null
          officer_name?: string | null
          organisation_id?: string
          patrol_id?: string
          scheduled_end?: string
          scheduled_start?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_shifts_patrol_id_fkey"
            columns: ["patrol_id"]
            isOneToOne: false
            referencedRelation: "patrols"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_waypoints: {
        Row: {
          coord_x: number | null
          coord_y: number | null
          created_at: string
          expected_minutes: number
          id: string
          name: string
          ord: number
          organisation_id: string
          patrol_id: string
          qr_token: string
        }
        Insert: {
          coord_x?: number | null
          coord_y?: number | null
          created_at?: string
          expected_minutes?: number
          id?: string
          name: string
          ord: number
          organisation_id: string
          patrol_id: string
          qr_token?: string
        }
        Update: {
          coord_x?: number | null
          coord_y?: number | null
          created_at?: string
          expected_minutes?: number
          id?: string
          name?: string
          ord?: number
          organisation_id?: string
          patrol_id?: string
          qr_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_waypoints_patrol_id_fkey"
            columns: ["patrol_id"]
            isOneToOne: false
            referencedRelation: "patrols"
            referencedColumns: ["id"]
          },
        ]
      }
      patrols: {
        Row: {
          archived_at: string | null
          checked_in: number
          checkin_method: string
          code: string
          created_at: string
          grace_period_minutes: number
          id: string
          location_id: string | null
          name: string
          next_check_in: string | null
          officer: string
          organisation_id: string
          shift: string
          status: string
          total_duration_minutes: number
          updated_at: string
          waypoints: number
        }
        Insert: {
          archived_at?: string | null
          checked_in?: number
          checkin_method?: string
          code: string
          created_at?: string
          grace_period_minutes?: number
          id?: string
          location_id?: string | null
          name: string
          next_check_in?: string | null
          officer: string
          organisation_id: string
          shift: string
          status?: string
          total_duration_minutes?: number
          updated_at?: string
          waypoints?: number
        }
        Update: {
          archived_at?: string | null
          checked_in?: number
          checkin_method?: string
          code?: string
          created_at?: string
          grace_period_minutes?: number
          id?: string
          location_id?: string | null
          name?: string
          next_check_in?: string | null
          officer?: string
          organisation_id?: string
          shift?: string
          status?: string
          total_duration_minutes?: number
          updated_at?: string
          waypoints?: number
        }
        Relationships: [
          {
            foreignKeyName: "patrols_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "organisation_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrols_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_organisation_id: string | null
          assigned_location_ids: string[]
          created_at: string
          display_name: string
          employee_id: string | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          phone: string | null
          photo_url: string | null
          status: string
          updated_at: string
          user_id: string
          zone: string | null
        }
        Insert: {
          active_organisation_id?: string | null
          assigned_location_ids?: string[]
          created_at?: string
          display_name?: string
          employee_id?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          phone?: string | null
          photo_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
          zone?: string | null
        }
        Update: {
          active_organisation_id?: string | null
          assigned_location_ids?: string[]
          created_at?: string
          display_name?: string
          employee_id?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          phone?: string | null
          photo_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_organisation_id_fkey"
            columns: ["active_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          assigned_location_ids: string[]
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          invited_by_name: string | null
          organisation_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          assigned_location_ids?: string[]
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          invited_by_name?: string | null
          organisation_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          assigned_location_ids?: string[]
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invited_by_name?: string | null
          organisation_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organisation_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organisation_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organisation_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_org_id: { Args: never; Returns: string }
      has_org_role: {
        Args: {
          _org_id: string
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_lemtik_admin: { Args: { _user_id: string }; Returns: boolean }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "manager"
        | "supervisor"
        | "officer"
        | "client_admin"
        | "lemtik_admin"
      incident_status:
        | "reported"
        | "acknowledged"
        | "responding"
        | "contained"
        | "resolved"
        | "escalated"
        | "closed"
      incident_type:
        | "intrusion"
        | "theft"
        | "medical"
        | "fire"
        | "suspicious"
        | "civil_unrest"
        | "other"
        | "robbery"
        | "armed_attack"
        | "kidnapping"
        | "vandalism"
        | "fraud_scam"
        | "cyber_incident"
      org_type: "estate" | "corporate" | "hotel" | "government"
      subscription_status:
        | "trial"
        | "active"
        | "past_due"
        | "suspended"
        | "cancelled"
      subscription_tier: "basic" | "professional" | "enterprise" | "government"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "manager",
        "supervisor",
        "officer",
        "client_admin",
        "lemtik_admin",
      ],
      incident_status: [
        "reported",
        "acknowledged",
        "responding",
        "contained",
        "resolved",
        "escalated",
        "closed",
      ],
      incident_type: [
        "intrusion",
        "theft",
        "medical",
        "fire",
        "suspicious",
        "civil_unrest",
        "other",
        "robbery",
        "armed_attack",
        "kidnapping",
        "vandalism",
        "fraud_scam",
        "cyber_incident",
      ],
      org_type: ["estate", "corporate", "hotel", "government"],
      subscription_status: [
        "trial",
        "active",
        "past_due",
        "suspended",
        "cancelled",
      ],
      subscription_tier: ["basic", "professional", "enterprise", "government"],
    },
  },
} as const
