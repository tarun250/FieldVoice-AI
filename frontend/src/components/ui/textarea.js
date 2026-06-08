import React from "react"
import { cn } from "../../lib/utils"

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 hover:border-slate-400 focus-visible:outline-none focus-visible:border-blue-600 focus-visible:ring-1 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:opacity-50 transition-all shadow-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
