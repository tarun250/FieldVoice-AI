import React from "react"
import { cn } from "../../lib/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-8 w-full rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 hover:border-slate-400 focus-visible:outline-none focus-visible:border-blue-600 focus-visible:ring-1 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:opacity-50 transition-all shadow-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
