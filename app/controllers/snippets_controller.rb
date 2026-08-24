class SnippetsController < ApplicationController
  # ADR-0012: a saved snippet is readable by anyone holding its URL; everything
  # that changes one needs the owner signed in.
  allow_unauthenticated_access only: :show

  before_action :set_owned_snippet, only: %i[ edit update destroy ]

  helper_method :owned_by_viewer?

  def index
    @snippets = Current.user.snippets.order(updated_at: :desc)
  end

  def show
    @snippet = Snippet.find(params[:id])
  end

  def new
    @snippet = Current.user.snippets.new
  end

  def create
    @snippet = Current.user.snippets.new(snippet_params)

    if @snippet.save
      redirect_to @snippet, notice: "Snippet saved."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @snippet.update(snippet_params)
      redirect_to @snippet, notice: "Snippet updated."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @snippet.destroy!
    redirect_to snippets_path, notice: "Snippet deleted.", status: :see_other
  end

  private
    # Scoping the lookup to the owner *is* the authorization: someone else's id
    # raises RecordNotFound, so a 404 covers both "gone" and "not yours" without
    # a second code path that could disagree with this one.
    def set_owned_snippet
      @snippet = Current.user.snippets.find(params[:id])
    end

    # `show` skips require_authentication, so Current.session is still unset
    # here even when the visitor holds a valid cookie. authenticated? resolves
    # it; asking for Current.user first would report every owner as a stranger.
    def owned_by_viewer?(snippet)
      authenticated? && Current.user == snippet.user
    end

    def snippet_params
      params.expect(snippet: [ :title, :code ])
    end
end
