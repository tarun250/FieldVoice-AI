import React from "react"
import { cva } from "class-variance-authority"
import { cn } from "../../lib/utils"

const alertVariants = cva(
  "relative w-full rounded border px-3 py-2 text-xs [&>svg+div]:translate-y-[0px] [&>svg]:absolute [&>svg]:left-3 [&>svg]:top-2.5 [&>svg]:text-foreground [&>svg~*]:pl-6",
  {
    variants: {
      variant: {
        default: "bg-slate-50 border-slate-200 text-slate-705",
        destructive:
          "border-red-200 text-red-700 [&>svg]:text-red-600 bg-red-50/55",
        warning:
          "border-amber-200/60 text-amber-700 [&>svg]:text-amber-600 bg-amber-50/55",
        success:
          "border-emerald-200/60 text-emerald-700 [&>svg]:text-emerald-600 bg-emerald-50/55",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight text-slate-800 mb-0.5", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-[10px] leading-normal text-slate-550", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
