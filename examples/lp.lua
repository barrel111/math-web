return {
  environments = {
    lp = {
      arguments = {"o", "m", "m"},
      render = function(environment, context)
        assert(context.display, "lp requires display math")
        local first = true
        local rows = context.commands(environment.body, {
          lpconstraint = {
            arguments = {{default = ""}, "m"},
            render = function(constraint)
              local label = first and "\\subjectto\\quad" or ""
              first = false
              return label .. " & " .. constraint.args[2] .. ", &\\quad& " .. constraint.args[1] .. " \\\\ "
            end,
          },
        })
        local tag = environment.args[1]
        local prefix = tag ~= false and "\\tag{$" .. tag .. "$}" or ""
        return prefix .. "\\begin{alignedat}{2}"
          .. environment.args[2] .. "\\quad & " .. environment.args[3] .. " &&\\\\ "
          .. rows .. "\\end{alignedat}"
      end,
    },
  },
}
