import React from "react"
import { cva } from "class-variance-authority"
import { cn } from "../../lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide transition-colors border uppercase select-none",
  {
    variants: {
      variant: {
        default:
          "bg-slate-100 border-slate-200 text-slate-700",
        secondary:
          "bg-slate-50 border-slate-200 text-slate-500",
        destructive:
          "bg-red-50 border-red-200/60 text-red-600 shadow-sm",
        outline: 
          "bg-transparent border-slate-200 text-slate-500",
        success: 
          "bg-emerald-50 border-emerald-250/60 text-emerald-600 shadow-sm",
        warning: 
          "bg-amber-50 border-amber-250/60 text-amber-600 shadow-sm",
        info: 
          "bg-blue-50 border-blue-200/60 text-blue-600 shadow-sm"
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
