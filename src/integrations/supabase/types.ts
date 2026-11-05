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
      analytics_events: {
        Row: {
          created_at: string
          id: string
          name: string
          properties: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          properties?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          properties?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      audio_lessons: {
        Row: {
          course_id: string
          created_at: string
          duration_seconds: number | null
          id: string
          lesson_id: string
          status: Database["public"]["Enums"]["job_status"]
          storage_path: string | null
          transcript: string | null
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          lesson_id: string
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
          transcript?: string | null
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          lesson_id?: string
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
          transcript?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audio_lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_lessons_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      chapters: {
        Row: {
          course_id: string
          created_at: string
          id: string
          position: number
          title: string
          unit_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          position?: number
          title: string
          unit_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          position?: number
          title?: string
          unit_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chapters_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chapters_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      content_blocks: {
        Row: {
          block_type: string
          confidence: number | null
          coordinates: Json | null
          course_id: string
          created_at: string
          duplicate_group: string | null
          file_id: string
          file_version: number
          id: string
          original_text: string
          page: number | null
          position: number
          processed_text: string | null
          section: string | null
          simplified_text: string | null
          user_id: string
        }
        Insert: {
          block_type?: string
          confidence?: number | null
          coordinates?: Json | null
          course_id: string
          created_at?: string
          duplicate_group?: string | null
          file_id: string
          file_version?: number
          id?: string
          original_text: string
          page?: number | null
          position?: number
          processed_text?: string | null
          section?: string | null
          simplified_text?: string | null
          user_id: string
        }
        Update: {
          block_type?: string
          confidence?: number | null
          coordinates?: Json | null
          course_id?: string
          created_at?: string
          duplicate_group?: string | null
          file_id?: string
          file_version?: number
          id?: string
          original_text?: string
          page?: number | null
          position?: number
          processed_text?: string | null
          section?: string | null
          simplified_text?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_blocks_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_blocks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          built_at: string | null
          created_at: string
          description: string | null
          exam_date: string | null
          id: string
          is_built: boolean
          language: string
          subject: string | null
          title: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          built_at?: string | null
          created_at?: string
          description?: string | null
          exam_date?: string | null
          id?: string
          is_built?: boolean
          language?: string
          subject?: string | null
          title: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          built_at?: string | null
          created_at?: string
          description?: string | null
          exam_date?: string | null
          id?: string
          is_built?: boolean
          language?: string
          subject?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      definitions: {
        Row: {
          course_id: string
          created_at: string
          definition: string
          id: string
          lesson_id: string | null
          support_status: Database["public"]["Enums"]["support_status"]
          term: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          definition: string
          id?: string
          lesson_id?: string | null
          support_status?: Database["public"]["Enums"]["support_status"]
          term: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          definition?: string
          id?: string
          lesson_id?: string | null
          support_status?: Database["public"]["Enums"]["support_status"]
          term?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "definitions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "definitions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_questions: {
        Row: {
          answer: Json | null
          exam_id: string
          id: string
          is_correct: boolean | null
          position: number
          question_id: string
          user_id: string
        }
        Insert: {
          answer?: Json | null
          exam_id: string
          id?: string
          is_correct?: boolean | null
          position?: number
          question_id: string
          user_id: string
        }
        Update: {
          answer?: Json | null
          exam_id?: string
          id?: string
          is_correct?: boolean | null
          position?: number
          question_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_questions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          completed_at: string | null
          config: Json
          correct_count: number
          course_id: string
          created_at: string
          id: string
          score: number | null
          started_at: string
          status: string
          title: string
          user_id: string
          wrong_count: number
        }
        Insert: {
          completed_at?: string | null
          config?: Json
          correct_count?: number
          course_id: string
          created_at?: string
          id?: string
          score?: number | null
          started_at?: string
          status?: string
          title: string
          user_id: string
          wrong_count?: number
        }
        Update: {
          completed_at?: string | null
          config?: Json
          correct_count?: number
          course_id?: string
          created_at?: string
          id?: string
          score?: number | null
          started_at?: string
          status?: string
          title?: string
          user_id?: string
          wrong_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "exams_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          description: string | null
          enabled: boolean
          key: string
          updated_at: string
        }
        Insert: {
          description?: string | null
          enabled?: boolean
          key: string
          updated_at?: string
        }
        Update: {
          description?: string | null
          enabled?: boolean
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      file_versions: {
        Row: {
          checksum: string | null
          created_at: string
          file_id: string
          id: string
          size_bytes: number
          storage_path: string
          user_id: string
          version: number
        }
        Insert: {
          checksum?: string | null
          created_at?: string
          file_id: string
          id?: string
          size_bytes?: number
          storage_path: string
          user_id: string
          version: number
        }
        Update: {
          checksum?: string | null
          created_at?: string
          file_id?: string
          id?: string
          size_bytes?: number
          storage_path?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "file_versions_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          course_id: string
          created_at: string
          current_version: number
          error_message: string | null
          extraction_report: Json
          id: string
          mime_type: string
          original_name: string
          page_count: number | null
          quality: Json
          security_status: string
          size_bytes: number
          status: Database["public"]["Enums"]["file_status"]
          status_detail: string | null
          storage_path: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          current_version?: number
          error_message?: string | null
          extraction_report?: Json
          id?: string
          mime_type: string
          original_name: string
          page_count?: number | null
          quality?: Json
          security_status?: string
          size_bytes?: number
          status?: Database["public"]["Enums"]["file_status"]
          status_detail?: string | null
          storage_path: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          current_version?: number
          error_message?: string | null
          extraction_report?: Json
          id?: string
          mime_type?: string
          original_name?: string
          page_count?: number | null
          quality?: Json
          security_status?: string
          size_bytes?: number
          status?: Database["public"]["Enums"]["file_status"]
          status_detail?: string | null
          storage_path?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          course_id: string | null
          created_at: string
          failure_reason: string | null
          file_id: string | null
          id: string
          kind: string
          payload: Json
          progress: number
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          failure_reason?: string | null
          file_id?: string | null
          id?: string
          kind: string
          payload?: Json
          progress?: number
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          failure_reason?: string | null
          file_id?: string | null
          id?: string
          kind?: string
          payload?: Json
          progress?: number
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          accuracy: Json
          chapter_id: string | null
          content_language: string | null
          course_id: string
          created_at: string
          explanation_detailed: string | null
          explanation_simple: string | null
          explanation_standard: string | null
          figures: Json
          formulas: Json
          id: string
          is_completed: boolean
          objective: string | null
          position: number
          source_pages: Json
          support_status: Database["public"]["Enums"]["support_status"]
          title: string
          updated_at: string
          user_id: string
          worked_examples: Json
        }
        Insert: {
          accuracy?: Json
          chapter_id?: string | null
          content_language?: string | null
          course_id: string
          created_at?: string
          explanation_detailed?: string | null
          explanation_simple?: string | null
          explanation_standard?: string | null
          figures?: Json
          formulas?: Json
          id?: string
          is_completed?: boolean
          objective?: string | null
          position?: number
          source_pages?: Json
          support_status?: Database["public"]["Enums"]["support_status"]
          title: string
          updated_at?: string
          user_id: string
          worked_examples?: Json
        }
        Update: {
          accuracy?: Json
          chapter_id?: string | null
          content_language?: string | null
          course_id?: string
          created_at?: string
          explanation_detailed?: string | null
          explanation_simple?: string | null
          explanation_standard?: string | null
          figures?: Json
          formulas?: Json
          id?: string
          is_completed?: boolean
          objective?: string | null
          position?: number
          source_pages?: Json
          support_status?: Database["public"]["Enums"]["support_status"]
          title?: string
          updated_at?: string
          user_id?: string
          worked_examples?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lessons_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      methods: {
        Row: {
          approved: boolean
          course_id: string
          created_at: string
          id: string
          lesson_id: string | null
          original_text: string
          simplified_explanation: string | null
          steps: Json
          title: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          course_id: string
          created_at?: string
          id?: string
          lesson_id?: string | null
          original_text: string
          simplified_explanation?: string | null
          steps?: Json
          title: string
          user_id: string
        }
        Update: {
          approved?: boolean
          course_id?: string
          created_at?: string
          id?: string
          lesson_id?: string | null
          original_text?: string
          simplified_explanation?: string | null
          steps?: Json
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "methods_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "methods_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          approved_as_source: boolean
          audio_duration_seconds: number | null
          audio_path: string | null
          body: string
          course_id: string | null
          created_at: string
          id: string
          image_path: string | null
          lesson_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_as_source?: boolean
          audio_duration_seconds?: number | null
          audio_path?: string | null
          body?: string
          course_id?: string | null
          created_at?: string
          id?: string
          image_path?: string | null
          lesson_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_as_source?: boolean
          audio_duration_seconds?: number | null
          audio_path?: string | null
          body?: string
          course_id?: string | null
          created_at?: string
          id?: string
          image_path?: string | null
          lesson_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          currency: string
          id: string
          is_active: boolean
          limits: Json
          name_ar: string
          name_en: string
          position: number
          price_monthly: number
          price_yearly: number
          updated_at: string
        }
        Insert: {
          currency?: string
          id: string
          is_active?: boolean
          limits?: Json
          name_ar: string
          name_en: string
          position?: number
          price_monthly?: number
          price_yearly?: number
          updated_at?: string
        }
        Update: {
          currency?: string
          id?: string
          is_active?: boolean
          limits?: Json
          name_ar?: string
          name_en?: string
          position?: number
          price_monthly?: number
          price_yearly?: number
          updated_at?: string
        }
        Relationships: []
      }
      processed_webhook_events: {
        Row: {
          event_id: string
          processed_at: string
          provider: string
        }
        Insert: {
          event_id: string
          processed_at?: string
          provider: string
        }
        Update: {
          event_id?: string
          processed_at?: string
          provider?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          content_language: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          language: string
          notification_prefs: Json
          study_prefs: Json
          theme: string
          updated_at: string
          video_language: string
        }
        Insert: {
          content_language?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          language?: string
          notification_prefs?: Json
          study_prefs?: Json
          theme?: string
          updated_at?: string
          video_language?: string
        }
        Update: {
          content_language?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          language?: string
          notification_prefs?: Json
          study_prefs?: Json
          theme?: string
          updated_at?: string
          video_language?: string
        }
        Relationships: []
      }
      progress: {
        Row: {
          course_id: string
          id: string
          lessons_completed: number
          lessons_total: number
          questions_answered: number
          questions_correct: number
          study_seconds: number
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          id?: string
          lessons_completed?: number
          lessons_total?: number
          questions_answered?: number
          questions_correct?: number
          study_seconds?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          id?: string
          lessons_completed?: number
          lessons_total?: number
          questions_answered?: number
          questions_correct?: number
          study_seconds?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "progress_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      question_attempts: {
        Row: {
          answer: Json | null
          course_id: string
          created_at: string
          exam_id: string | null
          id: string
          is_correct: boolean
          question_id: string
          time_spent_seconds: number
          user_id: string
        }
        Insert: {
          answer?: Json | null
          course_id: string
          created_at?: string
          exam_id?: string | null
          id?: string
          is_correct?: boolean
          question_id: string
          time_spent_seconds?: number
          user_id: string
        }
        Update: {
          answer?: Json | null
          course_id?: string
          created_at?: string
          exam_id?: string | null
          id?: string
          is_correct?: boolean
          question_id?: string
          time_spent_seconds?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_attempts_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          attempts: number
          correct_answer: Json
          correct_count: number
          course_id: string
          created_at: string
          difficulty: number
          ease: number
          explanation: string | null
          id: string
          interval_days: number
          is_published: boolean
          last_attempt_at: string | null
          lesson_id: string | null
          next_review_at: string | null
          options: Json
          prompt: string
          support_status: Database["public"]["Enums"]["support_status"]
          topic_id: string | null
          type: Database["public"]["Enums"]["question_type"]
          updated_at: string
          user_id: string
          validation: Json
        }
        Insert: {
          attempts?: number
          correct_answer: Json
          correct_count?: number
          course_id: string
          created_at?: string
          difficulty?: number
          ease?: number
          explanation?: string | null
          id?: string
          interval_days?: number
          is_published?: boolean
          last_attempt_at?: string | null
          lesson_id?: string | null
          next_review_at?: string | null
          options?: Json
          prompt: string
          support_status?: Database["public"]["Enums"]["support_status"]
          topic_id?: string | null
          type: Database["public"]["Enums"]["question_type"]
          updated_at?: string
          user_id: string
          validation?: Json
        }
        Update: {
          attempts?: number
          correct_answer?: Json
          correct_count?: number
          course_id?: string
          created_at?: string
          difficulty?: number
          ease?: number
          explanation?: string | null
          id?: string
          interval_days?: number
          is_published?: boolean
          last_attempt_at?: string | null
          lesson_id?: string | null
          next_review_at?: string | null
          options?: Json
          prompt?: string
          support_status?: Database["public"]["Enums"]["support_status"]
          topic_id?: string | null
          type?: Database["public"]["Enums"]["question_type"]
          updated_at?: string
          user_id?: string
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "questions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          completed_at: string | null
          course_id: string
          created_at: string
          due_at: string
          ease: number
          id: string
          interval_days: number
          last_result: string | null
          lesson_id: string | null
          topic_id: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          course_id: string
          created_at?: string
          due_at?: string
          ease?: number
          id?: string
          interval_days?: number
          last_result?: string | null
          lesson_id?: string | null
          topic_id?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          course_id?: string
          created_at?: string
          due_at?: string
          ease?: number
          id?: string
          interval_days?: number
          last_result?: string | null
          lesson_id?: string | null
          topic_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      source_conflicts: {
        Row: {
          block_a: string | null
          block_b: string | null
          course_id: string
          created_at: string
          difference: string | null
          id: string
          resolved_at: string | null
          resolved_block: string | null
          topic: string
          user_id: string
        }
        Insert: {
          block_a?: string | null
          block_b?: string | null
          course_id: string
          created_at?: string
          difference?: string | null
          id?: string
          resolved_at?: string | null
          resolved_block?: string | null
          topic: string
          user_id: string
        }
        Update: {
          block_a?: string | null
          block_b?: string | null
          course_id?: string
          created_at?: string
          difference?: string | null
          id?: string
          resolved_at?: string | null
          resolved_block?: string | null
          topic?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_conflicts_block_a_fkey"
            columns: ["block_a"]
            isOneToOne: false
            referencedRelation: "content_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_conflicts_block_b_fkey"
            columns: ["block_b"]
            isOneToOne: false
            referencedRelation: "content_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_conflicts_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_conflicts_resolved_block_fkey"
            columns: ["resolved_block"]
            isOneToOne: false
            referencedRelation: "content_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      source_media: {
        Row: {
          caption: string | null
          confidence: number | null
          content_block_id: string | null
          course_id: string
          created_at: string
          file_id: string
          file_version: number
          id: string
          kind: string
          mime_type: string
          page: number | null
          position: number
          storage_path: string | null
          updated_at: string
          user_id: string
          vision_status: string
          vision_text: string | null
        }
        Insert: {
          caption?: string | null
          confidence?: number | null
          content_block_id?: string | null
          course_id: string
          created_at?: string
          file_id: string
          file_version?: number
          id?: string
          kind?: string
          mime_type?: string
          page?: number | null
          position?: number
          storage_path?: string | null
          updated_at?: string
          user_id: string
          vision_status?: string
          vision_text?: string | null
        }
        Update: {
          caption?: string | null
          confidence?: number | null
          content_block_id?: string | null
          course_id?: string
          created_at?: string
          file_id?: string
          file_version?: number
          id?: string
          kind?: string
          mime_type?: string
          page?: number | null
          position?: number
          storage_path?: string | null
          updated_at?: string
          user_id?: string
          vision_status?: string
          vision_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_media_content_block_id_fkey"
            columns: ["content_block_id"]
            isOneToOne: false
            referencedRelation: "content_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_media_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_media_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      source_references: {
        Row: {
          content_block_id: string | null
          coordinates: Json | null
          course_id: string
          created_at: string
          file_id: string
          file_version: number
          id: string
          object_id: string
          object_type: string
          page: number | null
          quoted_text: string | null
          section: string | null
          user_id: string
        }
        Insert: {
          content_block_id?: string | null
          coordinates?: Json | null
          course_id: string
          created_at?: string
          file_id: string
          file_version?: number
          id?: string
          object_id: string
          object_type: string
          page?: number | null
          quoted_text?: string | null
          section?: string | null
          user_id: string
        }
        Update: {
          content_block_id?: string | null
          coordinates?: Json | null
          course_id?: string
          created_at?: string
          file_id?: string
          file_version?: number
          id?: string
          object_id?: string
          object_type?: string
          page?: number | null
          quoted_text?: string | null
          section?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_references_content_block_id_fkey"
            columns: ["content_block_id"]
            isOneToOne: false
            referencedRelation: "content_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_references_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_references_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      study_plan_items: {
        Row: {
          course_id: string
          created_at: string
          id: string
          is_done: boolean
          kind: string
          lesson_id: string | null
          minutes: number
          plan_id: string
          position: number
          scheduled_date: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          is_done?: boolean
          kind?: string
          lesson_id?: string | null
          minutes?: number
          plan_id: string
          position?: number
          scheduled_date: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          is_done?: boolean
          kind?: string
          lesson_id?: string | null
          minutes?: number
          plan_id?: string
          position?: number
          scheduled_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_plan_items_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_plan_items_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_plan_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "study_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      study_plans: {
        Row: {
          course_id: string
          created_at: string
          exam_date: string | null
          hours_per_day: number
          id: string
          is_active: boolean
          preferred_days: number[]
          target_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          exam_date?: string | null
          hours_per_day?: number
          id?: string
          is_active?: boolean
          preferred_days?: number[]
          target_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          exam_date?: string | null
          hours_per_day?: number
          id?: string
          is_active?: boolean
          preferred_days?: number[]
          target_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_plans_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      study_sessions: {
        Row: {
          course_id: string | null
          ended_at: string | null
          id: string
          lesson_id: string | null
          seconds: number
          started_at: string
          user_id: string
        }
        Insert: {
          course_id?: string | null
          ended_at?: string | null
          id?: string
          lesson_id?: string | null
          seconds?: number
          started_at?: string
          user_id: string
        }
        Update: {
          course_id?: string | null
          ended_at?: string | null
          id?: string
          lesson_id?: string | null
          seconds?: number
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_sessions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_sessions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          grace_until: string | null
          id: string
          period: string
          plan_id: string
          provider: string
          provider_ref: string | null
          status: string
          trial_ends_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          grace_until?: string | null
          id?: string
          period?: string
          plan_id: string
          provider?: string
          provider_ref?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          grace_until?: string | null
          id?: string
          period?: string
          plan_id?: string
          provider?: string
          provider_ref?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      summaries: {
        Row: {
          body: string
          course_id: string
          created_at: string
          id: string
          is_published: boolean
          kind: string
          lesson_id: string | null
          updated_at: string
          user_id: string
          validation: Json
        }
        Insert: {
          body: string
          course_id: string
          created_at?: string
          id?: string
          is_published?: boolean
          kind?: string
          lesson_id?: string | null
          updated_at?: string
          user_id: string
          validation?: Json
        }
        Update: {
          body?: string
          course_id?: string
          created_at?: string
          id?: string
          is_published?: boolean
          kind?: string
          lesson_id?: string | null
          updated_at?: string
          user_id?: string
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "summaries_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "summaries_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          kind?: string
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      topics: {
        Row: {
          course_id: string
          created_at: string
          id: string
          lesson_id: string | null
          mastery: number
          position: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          lesson_id?: string | null
          mastery?: number
          position?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          lesson_id?: string | null
          mastery?: number
          position?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          course_id: string
          created_at: string
          id: string
          position: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          position?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          position?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_scenes: {
        Row: {
          coordinates: Json | null
          end_ms: number
          file_id: string | null
          id: string
          kind: string
          narration: string | null
          page: number | null
          position: number
          start_ms: number
          text_segment: string | null
          title: string | null
          user_id: string
          video_id: string
          visual: string | null
        }
        Insert: {
          coordinates?: Json | null
          end_ms?: number
          file_id?: string | null
          id?: string
          kind?: string
          narration?: string | null
          page?: number | null
          position?: number
          start_ms?: number
          text_segment?: string | null
          title?: string | null
          user_id: string
          video_id: string
          visual?: string | null
        }
        Update: {
          coordinates?: Json | null
          end_ms?: number
          file_id?: string | null
          id?: string
          kind?: string
          narration?: string | null
          page?: number | null
          position?: number
          start_ms?: number
          text_segment?: string | null
          title?: string | null
          user_id?: string
          video_id?: string
          visual?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_scenes_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_scenes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          course_id: string
          created_at: string
          duration_ms: number
          id: string
          language: string
          lesson_id: string
          mode: string
          status: Database["public"]["Enums"]["job_status"]
          storage_path: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          duration_ms?: number
          id?: string
          language?: string
          lesson_id: string
          mode?: string
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          duration_ms?: number
          id?: string
          language?: string
          lesson_id?: string
          mode?: string
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "videos_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "videos_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "user" | "admin" | "super_admin"
      file_status:
        | "UPLOADING"
        | "PROCESSING"
        | "READING"
        | "OCR"
        | "EXTRACTING_STRUCTURE"
        | "ORGANIZING"
        | "INDEXING"
        | "QUALITY_CHECK"
        | "READY"
        | "FAILED"
      job_status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"
      question_type:
        | "MCQ"
        | "TRUE_FALSE"
        | "FILL_BLANK"
        | "DEFINITION"
        | "MATCHING"
        | "ORDERING"
        | "SHORT_ANSWER"
        | "CALCULATION"
        | "SCENARIO"
        | "PROBLEM_SOLVING"
      support_status:
        | "SUPPORTED"
        | "PARTIALLY_SUPPORTED"
        | "UNSUPPORTED"
        | "UNCLEAR"
        | "CONFLICTING"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["user", "admin", "super_admin"],
      file_status: [
        "UPLOADING",
        "PROCESSING",
        "READING",
        "OCR",
        "EXTRACTING_STRUCTURE",
        "ORGANIZING",
        "INDEXING",
        "QUALITY_CHECK",
        "READY",
        "FAILED",
      ],
      job_status: ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"],
      question_type: [
        "MCQ",
        "TRUE_FALSE",
        "FILL_BLANK",
        "DEFINITION",
        "MATCHING",
        "ORDERING",
        "SHORT_ANSWER",
        "CALCULATION",
        "SCENARIO",
        "PROBLEM_SOLVING",
      ],
      support_status: [
        "SUPPORTED",
        "PARTIALLY_SUPPORTED",
        "UNSUPPORTED",
        "UNCLEAR",
        "CONFLICTING",
      ],
    },
  },
} as const
